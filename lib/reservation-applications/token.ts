import { createHash, randomBytes } from "node:crypto";

/** 24바이트(192bit) 난수 → base64url 32자. DB CHECK 는 32자 이상을 요구한다. */
export const APPLICATION_LINK_TOKEN_BYTES = 24;
/** Phase 20 group/device/invite capability: 256 bit value, never stored in plaintext. */
export const APPLICATION_CAPABILITY_TOKEN_BYTES = 32;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function generateApplicationLinkToken(): string {
  return randomBytes(APPLICATION_LINK_TOKEN_BYTES).toString("base64url");
}

export function generateApplicationCapabilityToken(): string {
  return randomBytes(APPLICATION_CAPABILITY_TOKEN_BYTES).toString("base64url");
}

/** Store and compare the SHA-256 digest only. Raw capability values never enter Prisma data. */
export function hashApplicationCapabilityToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 형식이 맞지 않는 토큰은 DB 조회 없이 무효로 처리한다. */
export function isWellFormedApplicationLinkToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}
