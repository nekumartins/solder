import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationExtensionsClientInputs, AuthenticationResponseJSON, AuthenticatorTransport,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { AppContext } from '../context.js';
import { badRequest, conflict, notFound, unauthorized } from '../errors.js';
import { clearSession, issueSession } from '../session.js';
import { addressFromPrivateKey } from '../chain/eip3009.js';
import { asObject, handleArg, str } from '../validate.js';

/** The PRF input the client uses to derive its vault key. Constant by design. */
const RP_NAME = 'Solder';

export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { store, config, chain } = ctx;

  app.post('/api/auth/register/options', async (request) => {
    const body = asObject(request.body);
    const handle = handleArg(body['handle']);
    const displayName = str(body['displayName'], 'Display name', { max: 40 });
    if (store.getUserByHandle(handle)) throw conflict('handle_taken', 'That name is already taken');

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: config.rpId,
      userName: handle,
      userDisplayName: displayName,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'preferred',
      },
      // PRF is what lets the device derive a key nobody else can: it is the
      // reason there is no phrase to write down.
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    });

    const challengeId = store.putChallenge('register', options.challenge, { handle, displayName });
    return { challengeId, options };
  });

  app.post('/api/auth/register/verify', async (request, reply) => {
    const body = asObject(request.body);
    const challengeId = str(body['challengeId'], 'challengeId', { max: 64 });
    const response = body['response'] as RegistrationResponseJSON;
    if (!response || typeof response !== 'object') throw badRequest('bad_body', 'Missing response');

    const challenge = store.takeChallenge(challengeId, 'register');
    if (!challenge?.handle) throw badRequest('challenge_expired', 'That took too long — try again');

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.origins,
        expectedRPID: config.rpId,
        requireUserVerification: false,
      });
    } catch {
      throw badRequest('passkey_failed', "We couldn't confirm it was you");
    }
    if (!verification.verified) throw badRequest('passkey_failed', "We couldn't confirm it was you");

    if (store.getUserByHandle(challenge.handle)) {
      throw conflict('handle_taken', 'That name is already taken');
    }

    const { credential } = verification.registrationInfo;
    const prfSupported = Boolean(
      (response.clientExtensionResults as { prf?: { enabled?: boolean } } | undefined)?.prf?.enabled,
    );

    const user = store.transaction(() => {
      const created = store.createUser(challenge.handle!, challenge.display_name ?? challenge.handle!);
      store.addCredential({
        id: credential.id,
        user_id: created.id,
        public_key: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports ? JSON.stringify(credential.transports) : null,
        prf_supported: prfSupported ? 1 : 0,
      });
      return created;
    });

    issueSession(store, config, reply, user.id);
    return { user: { handle: user.handle, displayName: user.display_name }, prfSupported };
  });

  app.post('/api/auth/login/options', async (request) => {
    const body = asObject(request.body ?? {});
    const rawHandle = body['handle'];
    let allowCredentials: Array<{ id: string; transports?: AuthenticatorTransport[] }> | undefined;

    if (typeof rawHandle === 'string' && rawHandle.trim() !== '') {
      const user = store.getUserByHandle(handleArg(rawHandle));
      if (user) {
        allowCredentials = store.getCredentialsForUser(user.id).map((cred) => ({
          id: cred.id,
          ...(cred.transports ? { transports: JSON.parse(cred.transports) } : {}),
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      userVerification: 'preferred',
      ...(allowCredentials ? { allowCredentials } : {}),
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    });

    const challengeId = store.putChallenge('login', options.challenge);
    return { challengeId, options };
  });

  app.post('/api/auth/login/verify', async (request, reply) => {
    const body = asObject(request.body);
    const challengeId = str(body['challengeId'], 'challengeId', { max: 64 });
    const response = body['response'] as AuthenticationResponseJSON;
    if (!response || typeof response !== 'object') throw badRequest('bad_body', 'Missing response');

    const challenge = store.takeChallenge(challengeId, 'login');
    if (!challenge) throw badRequest('challenge_expired', 'That took too long — try again');

    const credential = store.getCredential(response.id);
    if (!credential) throw notFound('no_account', "We couldn't find your account on this device");

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.origins,
        expectedRPID: config.rpId,
        requireUserVerification: false,
        credential: {
          id: credential.id,
          publicKey: credential.public_key,
          counter: credential.counter,
          ...(credential.transports ? { transports: JSON.parse(credential.transports) } : {}),
        },
      });
    } catch {
      throw unauthorized("We couldn't confirm it was you");
    }
    if (!verification.verified) throw unauthorized("We couldn't confirm it was you");

    store.updateCredentialCounter(credential.id, verification.authenticationInfo.newCounter);
    const user = store.getUser(credential.user_id);
    if (!user) throw notFound('no_account', "We couldn't find your account");

    issueSession(store, config, reply, user.id);
    return {
      user: { handle: user.handle, displayName: user.display_name },
      hasVault: store.getVault(user.id) !== null,
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    clearSession(store, request, reply);
    return { ok: true };
  });

  // ---- development-only shortcut -----------------------------------------
  // Lets the e2e suite and passkey-less browsers drive the app. It can never
  // be enabled with NODE_ENV=production (see config.ts).
  if (config.devLogin) {
    app.post('/api/dev/login', async (request, reply) => {
      const body = asObject(request.body);
      const handle = handleArg(body['handle']);
      const user = store.getUserByHandle(handle);
      if (!user) throw notFound('no_account', 'Run `npm run seed` first');

      const seed = devSeedFor(handle);
      const address = addressFromPrivateKey(seed);
      if (!user.pubkey) {
        store.setUserPubkey(user.id, address);
        await chain.ensureAccount(address);
      }

      issueSession(store, config, reply, user.id);
      return {
        user: { handle: user.handle, displayName: user.display_name },
        secretKeyB64: Buffer.from(seed).toString('base64'),
      };
    });
  }
}

/** Deterministic demo keys so the seed script and dev login always agree. */
export function devSeedFor(handle: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(`solder-dev:${handle}`).digest());
}
