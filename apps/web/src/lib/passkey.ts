import { base64UrlToBytes, bytesToBase64Url } from './bytes.js';

/**
 * Passkeys do two jobs here:
 *   1. they are the sign-in, so there is no password
 *   2. their PRF extension derives a key only this person can produce, which
 *      is what encrypts the money key — so there is no phrase to write down
 *
 * The PRF input is a fixed string: the same person on the same passkey always
 * derives the same key, on any device the passkey syncs to.
 */
const PRF_INPUT = new TextEncoder().encode('solder-vault-v1');

export interface PasskeyResult {
  /** Serialized for the server to verify. */
  response: Record<string, unknown>;
  /** 32 bytes from the authenticator, or null when the device lacks PRF. */
  prfOutput: Uint8Array | null;
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function';
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function createPasskey(options: any): Promise<PasskeyResult> {
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...options,
    challenge: base64UrlToBytes(options.challenge),
    user: { ...options.user, id: base64UrlToBytes(options.user.id) },
    excludeCredentials: (options.excludeCredentials ?? []).map((credential: any) => ({
      ...credential,
      id: base64UrlToBytes(credential.id),
    })),
    extensions: { prf: { eval: { first: PRF_INPUT } } } as AuthenticationExtensionsClientInputs,
  };

  const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null;
  if (!credential) throw new Error('cancelled');

  const attestation = credential.response as AuthenticatorAttestationResponse;
  const extensions = credential.getClientExtensionResults() as PrfExtensionResults;

  return {
    response: {
      id: credential.id,
      rawId: bytesToBase64Url(new Uint8Array(credential.rawId)),
      type: credential.type,
      clientExtensionResults: {
        prf: { enabled: Boolean(extensions.prf?.enabled ?? extensions.prf?.results) },
      },
      response: {
        clientDataJSON: bytesToBase64Url(new Uint8Array(attestation.clientDataJSON)),
        attestationObject: bytesToBase64Url(new Uint8Array(attestation.attestationObject)),
        transports: attestation.getTransports?.() ?? [],
      },
    },
    prfOutput: prfFrom(extensions),
  };
}

export async function assertPasskey(options: any): Promise<PasskeyResult> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...options,
    challenge: base64UrlToBytes(options.challenge),
    allowCredentials: (options.allowCredentials ?? []).map((credential: any) => ({
      ...credential,
      id: base64UrlToBytes(credential.id),
    })),
    extensions: { prf: { eval: { first: PRF_INPUT } } } as AuthenticationExtensionsClientInputs,
  };

  const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null;
  if (!credential) throw new Error('cancelled');

  const assertion = credential.response as AuthenticatorAssertionResponse;
  const extensions = credential.getClientExtensionResults() as PrfExtensionResults;

  return {
    response: {
      id: credential.id,
      rawId: bytesToBase64Url(new Uint8Array(credential.rawId)),
      type: credential.type,
      clientExtensionResults: {},
      response: {
        clientDataJSON: bytesToBase64Url(new Uint8Array(assertion.clientDataJSON)),
        authenticatorData: bytesToBase64Url(new Uint8Array(assertion.authenticatorData)),
        signature: bytesToBase64Url(new Uint8Array(assertion.signature)),
        ...(assertion.userHandle
          ? { userHandle: bytesToBase64Url(new Uint8Array(assertion.userHandle)) }
          : {}),
      },
    },
    prfOutput: prfFrom(extensions),
  };
}

interface PrfExtensionResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer | Uint8Array } };
}

function prfFrom(extensions: PrfExtensionResults): Uint8Array | null {
  const first = extensions.prf?.results?.first;
  if (!first) return null;
  return first instanceof Uint8Array ? first : new Uint8Array(first);
}
