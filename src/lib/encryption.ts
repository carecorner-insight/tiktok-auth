import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM  = 'aes-256-gcm';
const IV_BYTES   = 12;   // 96-bit IV — recommended for GCM
const TAG_BYTES  = 16;   // 128-bit authentication tag

/**
 * Encrypts a UTF-8 string with AES-256-GCM.
 *
 * Output format: "<iv>.<authTag>.<ciphertext>" (all base64url, dot-separated).
 * A fresh random IV is generated for every call so two encryptions of the
 * same plaintext produce different ciphertexts.
 *
 * @param plaintext  The string to encrypt.
 * @param keyHex     64-character hex string (32 raw bytes = AES-256 key).
 */
export function encrypt(plaintext: string, keyHex: string): string {
  assertKeyLength(keyHex);
  const key = Buffer.from(keyHex, 'hex');
  const iv  = randomBytes(IV_BYTES);

  const cipher    = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag       = cipher.getAuthTag();

  return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

/**
 * Decrypts a string produced by encrypt().
 *
 * Throws if the key is wrong, the data has been tampered with (GCM auth tag
 * mismatch), or the format is invalid.
 */
export function decrypt(blob: string, keyHex: string): string {
  assertKeyLength(keyHex);
  const parts = blob.split('.');
  if (parts.length !== 3) throw new Error('encryption: invalid blob format');

  const [ivB64, tagB64, dataB64] = parts;
  const key  = Buffer.from(keyHex, 'hex');
  const iv   = Buffer.from(ivB64,  'base64url');
  const tag  = Buffer.from(tagB64, 'base64url');
  const data = Buffer.from(dataB64,'base64url');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}

/**
 * Returns true if a Redis-stored string is an encrypted blob (iv.tag.cipher)
 * rather than legacy plaintext JSON.
 */
export function isEncrypted(value: string): boolean {
  return !value.startsWith('{');
}

function assertKeyLength(keyHex: string): void {
  if (keyHex.length !== 64) {
    throw new Error(`encryption: key must be 64 hex chars (32 bytes), got ${keyHex.length}`);
  }
}
