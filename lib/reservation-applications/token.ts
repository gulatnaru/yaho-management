import { randomBytes } from "node:crypto";

/** 24바이트(192bit) 난수 → base64url 32자. DB CHECK 는 32자 이상을 요구한다. */
export const APPLICATION_LINK_TOKEN_BYTES = 24;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function generateApplicationLinkToken(): string {
  return randomBytes(APPLICATION_LINK_TOKEN_BYTES).toString("base64url");
}

/** 형식이 맞지 않는 토큰은 DB 조회 없이 무효로 처리한다. */
export function isWellFormedApplicationLinkToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}
