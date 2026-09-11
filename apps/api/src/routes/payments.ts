import type { FastifyInstance } from 'fastify';
import { COPY } from '@solder/shared';
import { ChainError } from '../chain/index.js';
import type { AppContext } from '../context.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { newId } from '../ids.js';
import { publishBalance, publishEvent } from '../notify.js';
import { requireUser } from '../session.js';
import { threadEvent } from '../serialize.js';
import { asObject, emoji, handleArg, micros, optionalStr, str } from '../validate.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The payment lifecycle.
 *
 *   POST /api/payments          server composes the transfer and keeps the bytes
 *   (client signs those bytes with the key only it can unlock)
 *   POST /api/payments/:id/submit   server verifies the signature, pays the fee, submits
 *
 * The client never composes what the relayer signs, so it cannot smuggle an
 * instruction past the fee payer.
 */
export async function paymentRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { store, chain, config } = ctx;

  app.post('/api/payments', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const user = requireUser(store, request);
    const body = asObject(request.body);
    const toHandle = handleArg(body['toHandle']);
    const amount = micros(body['amountMicros'], 'amount');
    const note = optionalStr(body['note'], 'note', 140);
    const noteEmoji = emoji(body['emoji']);
    const requestEventId = optionalStr(body['requestEventId'], 'requestEventId', 64);

    if (!user.pubkey) throw conflict('setup_incomplete', 'Finish setting up your account first');

    const recipient = store.getUserByHandle(toHandle);
    if (!recipient) throw notFound('handle_not_found', COPY.pay.unknownPerson);
    if (recipient.id === user.id) throw badRequest('self_payment', COPY.pay.self);
    if (!recipient.pubkey) throw badRequest('recipient_not_ready', 'They have not finished setting up yet');

    const balance = await chain.getBalance(user.pubkey);
    if (balance < amount) throw badRequest('insufficient_funds', COPY.pay.insufficient);

    const spentToday = store.sentSince(user.id, Date.now() - DAY_MS);
    if (spentToday + amount > config.dailySendLimitMicros) {
      throw badRequest('daily_limit', COPY.pay.tooBig);
    }

    // A payment answering a request is linked to it, so the request can flip to paid.
    let linkedRequestId: string | null = null;
    let splitId: string | null = null;
    if (requestEventId) {
      const requestEvent = store.getEvent(requestEventId);
      if (
        !requestEvent || requestEvent.kind !== 'request' ||
        requestEvent.to_user !== user.id || requestEvent.from_user !== recipient.id
      ) {
        throw notFound('request_not_found', 'That request is no longer open');
      }
      if (requestEvent.status !== 'open') throw badRequest('request_closed', 'That request is no longer open');
      linkedRequestId = requestEvent.id;
      splitId = requestEvent.split_id;
    }

    const thread = store.getOrCreateThread(user.id, recipient.id);
    const event = store.createEvent({
      threadId: thread.id,
      kind: 'payment',
      from: user.id,
      to: recipient.id,
      amountMicros: amount,
      note,
      emoji: noteEmoji,
      status: 'pending',
      splitId,
      requestEventId: linkedRequestId,
    });

    const prepared = await chain.prepareTransfer({
      ref: event.id,
      from: user.pubkey,
      to: recipient.pubkey,
      micros: amount,
    });

    const paymentId = newId('pay');
    store.createPrepared({
      id: paymentId,
      user_id: user.id,
      event_id: event.id,
      message_b64: prepared.messageB64,
      expires_at: prepared.expiresAt,
    });

    return {
      paymentId,
      eventId: event.id,
      messageB64: prepared.messageB64,
      expiresAt: prepared.expiresAt,
    };
  });

  app.post('/api/payments/:id/submit', async (request) => {
    const user = requireUser(store, request);
    const { id } = request.params as { id: string };
    const body = asObject(request.body);
    const signatureB64 = str(body['signatureB64'], 'signature', { max: 200 });

    const prepared = store.getPrepared(id);
    if (!prepared || prepared.user_id !== user.id) throw notFound('payment_not_found', 'That payment expired');
    if (prepared.expires_at < Date.now()) throw badRequest('expired', 'That took too long — try again');

    // Atomic: only the first submit for this payment gets through.
    if (!store.consumePrepared(id)) throw badRequest('already_submitted', 'That payment was already sent');

    const event = store.getEvent(prepared.event_id);
    if (!event) throw notFound('payment_not_found', 'That payment expired');

    // The transfer the adapter must prove the bytes describe comes from our
    // own row, never from anything the client sent.
    const recipient = store.getUser(event.to_user);
    if (!recipient?.pubkey) throw notFound('payment_not_found', 'That payment expired');

    let result;
    try {
      result = await chain.submitTransfer({
        transfer: {
          ref: event.id,
          from: user.pubkey!,
          to: recipient.pubkey,
          micros: BigInt(event.amount_micros ?? '0'),
        },
        messageB64: prepared.message_b64,
        signatureB64,
      });
    } catch (error) {
      store.setEventStatus(event.id, 'failed');
      const updated = store.getEvent(event.id)!;
      publishEvent(ctx, updated, 'event.updated');
      if (error instanceof ChainError) throw badRequest(error.code, error.message);
      throw error;
    }

    store.transaction(() => {
      store.setEventStatus(event.id, result.status, {
        signature: result.signature,
        confirmedAt: result.status === 'confirmed' ? Date.now() : null,
      });
      store.touchThread(event.thread_id, event.id, event.to_user, true);

      if (event.request_event_id) {
        store.setEventStatus(event.request_event_id, 'paid');
        const requestEvent = store.getEvent(event.request_event_id);
        if (requestEvent?.split_id) {
          store.setSplitParticipantStatus(requestEvent.split_id, user.id, 'paid');
        }
      }
    });

    const updated = store.getEvent(event.id)!;
    publishEvent(ctx, updated, 'event.new');
    if (event.request_event_id) {
      const requestEvent = store.getEvent(event.request_event_id);
      if (requestEvent) publishEvent(ctx, requestEvent, 'event.updated');
    }
    await Promise.all([publishBalance(ctx, event.from_user), publishBalance(ctx, event.to_user)]);

    return {
      event: threadEvent(store, updated, user.id),
      balanceMicros: (await chain.getBalance(user.pubkey!)).toString(),
    };
  });

  app.get('/api/payments/:id', async (request) => {
    const user = requireUser(store, request);
    const { id } = request.params as { id: string };
    const prepared = store.getPrepared(id);
    if (!prepared || prepared.user_id !== user.id) throw notFound('payment_not_found', 'That payment expired');
    const event = store.getEvent(prepared.event_id);
    if (!event) throw notFound('payment_not_found', 'That payment expired');
    return { event: threadEvent(store, event, user.id) };
  });
}

/**
 * Watches in-flight payments to confirmation and clears away transfers nobody
 * ever signed, so a cancelled biometric prompt leaves no trace.
 */
export function startPaymentWatcher(ctx: AppContext, intervalMs = 400): NodeJS.Timeout {
  const { store, chain } = ctx;
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (const event of store.pendingPayments()) {
        if (!event.chain_signature) continue;
        const status = await chain.getStatus(event.chain_signature);
        if (status === 'pending') continue;
        store.setEventStatus(event.id, status, {
          confirmedAt: status === 'confirmed' ? Date.now() : null,
        });
        const updated = store.getEvent(event.id);
        if (!updated) continue;
        publishEvent(ctx, updated, 'event.updated');
        await Promise.all([
          publishBalance(ctx, updated.from_user),
          publishBalance(ctx, updated.to_user),
        ]);
      }

      for (const stale of store.expiredPrepared(Date.now())) {
        const event = store.getEvent(stale.event_id);
        store.deletePrepared(stale.id);
        if (event && event.status === 'pending' && !event.chain_signature) {
          store.deleteEvent(event.id);
        }
      }
    } catch {
      // A watcher tick must never take the server down; the next tick retries.
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  return timer;
}
