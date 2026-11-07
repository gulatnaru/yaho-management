import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSyntheticRecipient, encryptSyntheticRecipient, nonceFromSequence, recipientAad, type CryptoSafety } from "@/lib/kakao/send-contract";

const binding = { environment: "preview" as const, registrationId: "recipient_1", registrationVersion: "v1", keyVersion: "key_1" };
const safety = { counterCommitted: true, counterCurrent: true, nonceUnused: true, keyActive: true, recoveryVerified: true, registrationActive: true, rotationComplete: true } as const;
describe("D-08 pure server encryption contract", () => {
  it("encodes 96-bit monotonic nonce and length-prefixed tuple", () => {
    expect(nonceFromSequence(1n).toString("hex")).toBe("000000000000000000000001"); expect(() => nonceFromSequence(0n)).toThrow(); expect(() => nonceFromSequence(1n << 63n)).toThrow();
    const aad = recipientAad(binding); expect(aad.readUInt32BE(0)).toBe(Buffer.byteLength("yaho-kakao-recipient-v1"));
    expect(recipientAad({ ...binding, registrationId: "a", registrationVersion: "bc" })).not.toEqual(recipientAad({ ...binding, registrationId: "ab", registrationVersion: "c" }));
  });
  it("round trips in memory and rejects altered AAD, key, nonce, tag and ciphertext", () => {
    const key = randomBytes(32); const plaintext = randomBytes(16); const encrypted = encryptSyntheticRecipient(plaintext, key, 1n, binding, safety);
    expect(decryptSyntheticRecipient(encrypted, key, binding, safety)).toEqual(plaintext);
    for (const field of ["ciphertext", "nonce", "tag"] as const) { const altered = { ...encrypted, [field]: Buffer.from(encrypted[field]) }; altered[field][0] ^= 1; expect(() => decryptSyntheticRecipient(altered, key, binding, safety)).toThrow(); }
    for (const changed of [{ registrationId: "other" }, { registrationVersion: "v2" }, { keyVersion: "key_2" }, { environment: "production" }]) expect(() => decryptSyntheticRecipient(encrypted, key, { ...binding, ...changed } as typeof binding, safety)).toThrow();
    expect(() => decryptSyntheticRecipient(encrypted, randomBytes(32), binding, safety)).toThrow();
    expect(() => decryptSyntheticRecipient(encrypted, Buffer.alloc(0), binding, safety)).toThrow();
    expect(() => encryptSyntheticRecipient(Buffer.alloc(0), key, 2n, binding, safety)).toThrow();
  });
  it.each(Object.keys(safety))("blocks when %s is unproven", (field) => {
    const key = randomBytes(32); const plaintext = randomBytes(16); const encrypted = encryptSyntheticRecipient(plaintext, key, 1n, binding, safety);
    const unsafe = { ...safety, [field]: false } as unknown as CryptoSafety;
    expect(() => encryptSyntheticRecipient(plaintext, key, 2n, binding, unsafe)).toThrow();
    expect(() => decryptSyntheticRecipient(encrypted, key, binding, unsafe)).toThrow();
  });
});
