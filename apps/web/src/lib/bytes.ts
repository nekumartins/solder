export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}
