import "server-only";
import { createCipheriv, createDecipheriv } from "node:crypto";
import { nonceFromSequence, recipientAad, type Ciphertext, type RecipientBinding } from "@/lib/kakao/send-contract";

export function nonceWithinHighWater(value: Uint8Array, highWater: bigint): boolean {
  if (!(value instanceof Uint8Array) || value.length !== 12 || typeof highWater !== "bigint" || highWater < 1n || highWater > (1n << 63n) - 1n) return false;
  const nonce = Buffer.from(value); const sequence = nonce.readBigUInt64BE(4);
  return nonce.readUInt32BE(0) === 0 && sequence >= 1n && sequence <= highWater;
}

/** Storage-side primitives for pending and verified-inactive records, not an active-send attestation. */
export function encryptPendingRecipient(plaintext: Buffer, key: Buffer, sequence: bigint, binding: RecipientBinding): Ciphertext {
  if (!Buffer.isBuffer(plaintext) || !plaintext.length || !Buffer.isBuffer(key) || key.length !== 32) throw new Error("Invalid encryption input.");
  const nonce = nonceFromSequence(sequence); const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(recipientAad(binding));
  return { ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]), nonce, tag: cipher.getAuthTag() };
}

export function decryptInactiveRecipient(value: Ciphertext, key: Buffer, binding: RecipientBinding): Buffer {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !Buffer.isBuffer(value.ciphertext) || !value.ciphertext.length || !Buffer.isBuffer(value.nonce) || value.nonce.length !== 12 || !Buffer.isBuffer(value.tag) || value.tag.length !== 16) throw new Error("Invalid encryption input.");
  const decipher = createDecipheriv("aes-256-gcm", key, value.nonce, { authTagLength: 16 });
  decipher.setAAD(recipientAad(binding)); decipher.setAuthTag(value.tag);
  return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]);
}
