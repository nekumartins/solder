import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashTypedData, recoverAddress, verifyTypedData, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  addressFromPrivateKey, authorizationDigest, hex0x, isAddress, nonceFor, recoverSigner,
  sameAddress, signDigest, toChecksumAddress, type Authorization, type Eip712Domain,
} from './eip3009.js';

/**
 * These bytes are what a person's key actually signs, so they are checked
 * against viem's independent implementation rather than only against
 * themselves.
 */

const DOMAIN: Eip712Domain = {
  name: 'USD Coin',
  version: '2',
  chainId: 1n,
  verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
};

const PRIVATE_KEY = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';

function viemDigest(auth: Authorization) {
  return hashTypedData({
    domain: {
      name: DOMAIN.name,
      version: DOMAIN.version,
      chainId: Number(DOMAIN.chainId),
      verifyingContract: DOMAIN.verifyingContract as `0x${string}`,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: auth.from as `0x${string}`,
      to: auth.to as `0x${string}`,
      value: auth.value,
      validAfter: auth.validAfter,
      validBefore: auth.validBefore,
      nonce: hex0x(auth.nonce) as `0x${string}`,
    },
  });
}

const AUTH: Authorization = {
  from: '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF',
  to: '0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69',
  value: 12_500_000n,
  validAfter: 0n,
  validBefore: 1_800_000_000n,
  nonce: nonceFor('evt_demo'),
};

test('the digest matches an independent EIP-712 implementation', () => {
  assert.equal(hex0x(authorizationDigest(DOMAIN, AUTH)), viemDigest(AUTH));
});

test('every field is bound into the digest', () => {
  const base = hex0x(authorizationDigest(DOMAIN, AUTH));
  const variants: Array<[string, Authorization]> = [
    ['recipient', { ...AUTH, to: '0x1111111111111111111111111111111111111111' }],
    ['amount', { ...AUTH, value: 12_500_001n }],
    ['sender', { ...AUTH, from: '0x1111111111111111111111111111111111111111' }],
    ['deadline', { ...AUTH, validBefore: 1_800_000_001n }],
    ['nonce', { ...AUTH, nonce: nonceFor('evt_other') }],
  ];
  for (const [field, variant] of variants) {
    assert.notEqual(hex0x(authorizationDigest(DOMAIN, variant)), base, `${field} is not bound`);
    assert.equal(hex0x(authorizationDigest(DOMAIN, variant)), viemDigest(variant));
  }
  // The domain matters too: the same authorisation on another chain is a
  // different signature, so a mainnet signature cannot be replayed on a testnet.
  assert.notEqual(hex0x(authorizationDigest({ ...DOMAIN, chainId: 8453n }, AUTH)), base);
});

test('a signature recovers to the signer, and viem agrees', async () => {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const key = Buffer.from(PRIVATE_KEY.slice(2), 'hex');
  const auth: Authorization = { ...AUTH, from: account.address };

  const digest = authorizationDigest(DOMAIN, auth);
  const signature = signDigest(digest, key);

  assert.ok(sameAddress(recoverSigner(digest, signature), account.address));
  assert.equal(
    getAddress(await recoverAddress({ hash: hex0x(digest) as `0x${string}`, signature: hex0x(signature) as `0x${string}` })),
    getAddress(account.address),
  );
  // …and a contract verifying the typed data would accept it.
  assert.equal(await verifyTypedData({
    address: account.address,
    domain: {
      name: DOMAIN.name, version: DOMAIN.version,
      chainId: Number(DOMAIN.chainId), verifyingContract: DOMAIN.verifyingContract as `0x${string}`,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: auth.from as `0x${string}`, to: auth.to as `0x${string}`, value: auth.value,
      validAfter: auth.validAfter, validBefore: auth.validBefore,
      nonce: hex0x(auth.nonce) as `0x${string}`,
    },
    signature: hex0x(signature) as `0x${string}`,
  }), true);
});

test('a signature over other bytes does not recover to the signer', () => {
  const key = Buffer.from(PRIVATE_KEY.slice(2), 'hex');
  const digest = authorizationDigest(DOMAIN, AUTH);
  const other = authorizationDigest(DOMAIN, { ...AUTH, value: 99_000_000n });
  const signature = signDigest(other, key);
  assert.ok(!sameAddress(recoverSigner(digest, signature), addressFromPrivateKey(key)));
});

test('addresses are derived and checksummed the way Ethereum expects', () => {
  const key = Buffer.from(PRIVATE_KEY.slice(2), 'hex');
  const derived = addressFromPrivateKey(key);
  assert.equal(derived, getAddress(privateKeyToAccount(PRIVATE_KEY).address));
  assert.ok(isAddress(derived));

  // A known EIP-55 vector.
  assert.equal(
    toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'),
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  );
  assert.ok(!isAddress('0xnope'));
  assert.ok(sameAddress(derived.toLowerCase(), derived));
});

test('each payment gets its own single-use nonce', () => {
  assert.equal(nonceFor('evt_a').length, 32);
  assert.deepEqual(nonceFor('evt_a'), nonceFor('evt_a'));
  assert.notDeepEqual(nonceFor('evt_a'), nonceFor('evt_b'));
});
