import type { FastifyInstance } from 'fastify';
import { COPY, type ClaimSummary } from '@solder/shared';
import { ChainError } from '../chain/index.js';
import { isAddress, sameAddress } from '../chain/eip3009.js';
import type { AppContext } from '../context.js';
import type { ClaimRow } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { newId } from '../ids.js';
import { publishBalance, publishEvent } from '../notify.js';
import { currentUser, requireUser } from '../session.js';
import { publicUser, threadEvent } from '../serialize.js';
import { asObject, emoji, micros, optionalStr, str } from '../validate.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sending money to someone who does not have an account yet.
 *
 * The money goes to a holding account whose key is derived on the sender's
 * device and travels in the link's fragment — which browsers never send to a
 * server. So the money waits on-chain, and only the person holding the link
 * (or the sender, who can re-derive the same key) can move it. Nobody here
 * ever holds it.
 */
export async function claimRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { store, chain, config } = ctx;

  app.post('/api/claims', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const user = requireUser(store, request);
    const body = asObject(request.body);
    const amount = micros(body['amountMicros'], 'amount');
    const note = optionalStr(body['note'], 'note', 140);
    const claimEmoji = emoji(body['emoji']);
    const escrowAddress = str(body['escrowAddress'], 'escrowAddress', { max: 64 });
    // Not a secret on its own: without the sender's own key it derives nothing.
    const derivationRef = optionalStr(body['derivationRef'], 'derivationRef', 64);

    if (!user.pubkey) throw conflict('setup_incomplete', 'Finish setting up your account first');
    if (!isAddress(escrowAddress)) throw badRequest('bad_account_key', 'Unsupported account key');
    if (sameAddress(escrowAddress, user.pubkey)) {
      throw badRequest('bad_account_key', 'Unsupported account key');
    }
    if (store.getUserByPubkey(escrowAddress)) {
      throw badRequest('bad_account_key', 'Unsupported account key');
    }

    if (await chain.getBalance(user.pubkey) < amount) {
      throw badRequest('insufficient_funds', COPY.pay.insufficient);
    }
    if (store.sentSince(user.id, Date.now() - DAY_MS) + amount > config.dailySendLimitMicros) {
      throw badRequest('daily_limit', COPY.pay.tooBig);
    }

    const claim = store.createClaim({
      fromUser: user.id, escrowAddress, amountMicros: amount, note, emoji: claimEmoji,
      derivationRef,
    });
    await chain.ensureAccount(escrowAddress);

    const prepared = await chain.prepareTransfer({
      ref: claim.id, from: user.pubkey, to: escrowAddress, micros: amount,
    });
    const paymentId = newId('pay');
    store.createPrepared({
      id: paymentId, user_id: user.id, event_id: claim.id,
      message_b64: prepared.messageB64, expires_at: prepared.expiresAt,
    });

    return { claimId: claim.id, paymentId, messageB64: prepared.messageB64, expiresAt: prepared.expiresAt };
  });

  /** Second half of creating a link: the sender's signature funds the holding account. */
  app.post('/api/claims/:id/fund', async (request) => {
    const user = requireUser(store, request);
    const { id } = request.params as { id: string };
    const body = asObject(request.body);
    const signatureB64 = str(body['signatureB64'], 'signature', { max: 200 });

    const claim = mustFind(store.getClaim(id));
    if (claim.from_user !== user.id) throw forbidden('That link is not yours');
    if (claim.status !== 'funding') throw conflict('claim_closed', COPY.link.gone);

    const prepared = store.getPrepared(String(body['paymentId'] ?? ''));
    if (!prepared || prepared.event_id !== claim.id || prepared.user_id !== user.id) {
      throw notFound('payment_not_found', 'That payment expired');
    }
    if (!store.consumePrepared(prepared.id)) {
      throw badRequest('already_submitted', 'That payment was already sent');
    }

    try {
      await chain.submitTransfer({
        transfer: {
          ref: claim.id, from: user.pubkey!, to: claim.escrow_address,
          micros: BigInt(claim.amount_micros),
        },
        messageB64: prepared.message_b64,
        signatureB64,
        expiresAt: prepared.expires_at,
      });
    } catch (error) {
      store.setClaimStatus(claim.id, 'failed');
      if (error instanceof ChainError) throw badRequest(error.code, error.message);
      throw error;
    }

    store.setClaimStatus(claim.id, 'open');
    await publishBalance(ctx, user.id);
    return { claim: summarize(ctx, store.getClaim(claim.id)!) };
  });

  /**
   * What the link shows before anyone signs in — enough to say who sent what,
   * and nothing that would let a passer-by take it.
   */
  app.get('/api/claims/:id', async (request) => {
    const { id } = request.params as { id: string };
    const claim = mustFind(store.getClaim(id));
    const viewer = currentUser(store, request);
    return {
      claim: summarize(ctx, claim),
      yours: viewer?.id === claim.from_user,
    };
  });

  /** Prepares the move out of the holding account and into the caller's own. */
  app.post('/api/claims/:id/prepare', async (request) => {
    const { user, claim } = claimant(ctx, request);
    if (!user.pubkey) throw conflict('setup_incomplete', 'Finish setting up your account first');
    if (claim.status !== 'open') throw conflict('claim_closed', COPY.link.gone);

    const ref = `${claim.id}-out`;
    const prepared = await chain.prepareTransfer({
      ref, from: claim.escrow_address, to: user.pubkey, micros: BigInt(claim.amount_micros),
    });
    const paymentId = newId('pay');
    store.createPrepared({
      id: paymentId, user_id: user.id, event_id: ref,
      message_b64: prepared.messageB64, expires_at: prepared.expiresAt,
    });
    return { paymentId, messageB64: prepared.messageB64, expiresAt: prepared.expiresAt };
  });

  /**
   * The signature here comes from the holding account's own key, which only
   * the link-holder or the sender can derive. The server checks it recovers to
   * that address before paying to publish it.
   */
  app.post('/api/claims/:id/settle', async (request) => {
    const { user, claim } = claimant(ctx, request);
    const body = asObject(request.body);
    const signatureB64 = str(body['signatureB64'], 'signature', { max: 200 });
    const paymentId = str(body['paymentId'], 'paymentId', { max: 64 });

    const prepared = store.getPrepared(paymentId);
    if (!prepared || prepared.event_id !== `${claim.id}-out` || prepared.user_id !== user.id) {
      throw notFound('payment_not_found', 'That payment expired');
    }
    // Only one person can pick a link up, even if two tap at the same moment.
    if (!store.lockClaim(claim.id)) throw conflict('claim_closed', COPY.link.gone);
    if (!store.consumePrepared(prepared.id)) {
      store.setClaimStatus(claim.id, 'open');
      throw badRequest('already_submitted', 'That payment was already sent');
    }

    const reclaiming = claim.from_user === user.id;
    try {
      await chain.submitTransfer({
        transfer: {
          ref: `${claim.id}-out`, from: claim.escrow_address, to: user.pubkey!,
          micros: BigInt(claim.amount_micros),
        },
        messageB64: prepared.message_b64,
        signatureB64,
        expiresAt: prepared.expires_at,
      });
    } catch (error) {
      store.setClaimStatus(claim.id, 'open');
      if (error instanceof ChainError) throw badRequest(error.code, error.message);
      throw error;
    }

    const sender = store.getUser(claim.from_user)!;
    let event = null;

    if (reclaiming) {
      store.setClaimStatus(claim.id, 'reclaimed');
    } else {
      // The payment now has a real recipient, so it becomes an ordinary
      // message in a conversation between the two of them.
      const thread = store.getOrCreateThread(sender.id, user.id);
      const row = store.createEvent({
        threadId: thread.id, kind: 'payment', from: sender.id, to: user.id,
        amountMicros: BigInt(claim.amount_micros), note: claim.note, emoji: claim.emoji,
        status: 'confirmed',
      });
      store.setEventStatus(row.id, 'confirmed', { confirmedAt: Date.now() });
      store.touchThread(thread.id, row.id, sender.id);
      store.setClaimStatus(claim.id, 'claimed', { claimedBy: user.id, eventId: row.id });
      event = store.getEvent(row.id)!;
      publishEvent(ctx, event, 'event.new');
    }

    await Promise.all([publishBalance(ctx, user.id), publishBalance(ctx, sender.id)]);
    return {
      claim: summarize(ctx, store.getClaim(claim.id)!),
      event: event ? threadEvent(store, event, user.id) : null,
      reclaimed: reclaiming,
    };
  });

  /**
   * Links the signed-in person has sent that nobody has picked up yet. The
   * derivation salt comes back so their device can rebuild the holding
   * account's key and take the money back.
   */
  app.get('/api/claims', async (request) => {
    const user = requireUser(store, request);
    return {
      claims: store.openClaimsFrom(user.id).map((claim) => ({
        ...summarize(ctx, claim),
        derivationRef: claim.derivation_ref,
      })),
    };
  });
}

function mustFind(claim: ClaimRow | null): ClaimRow {
  if (!claim) throw notFound('claim_not_found', COPY.link.gone);
  return claim;
}

function claimant(ctx: AppContext, request: Parameters<typeof requireUser>[1]) {
  const user = requireUser(ctx.store, request);
  const claim = mustFind(ctx.store.getClaim((request.params as { id: string }).id));
  if (claim.status === 'claimed' || claim.status === 'reclaimed') {
    throw conflict('claim_closed', COPY.link.gone);
  }
  return { user, claim };
}

function summarize(ctx: AppContext, claim: ClaimRow): ClaimSummary {
  const sender = ctx.store.getUser(claim.from_user);
  return {
    id: claim.id,
    from: sender ? publicUser(sender) : { handle: 'someone', displayName: 'Someone' },
    amountMicros: claim.amount_micros,
    note: claim.note,
    emoji: claim.emoji,
    status: claim.status as ClaimSummary['status'],
    createdAt: claim.created_at,
  };
}
