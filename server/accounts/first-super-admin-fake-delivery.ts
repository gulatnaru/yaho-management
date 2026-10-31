import { firstSuperAdminHarnessEnabled } from "./first-super-admin";
/** Isolated harness only. Never transmits messages and never logs a token. */
let lastToken: string | undefined;
export function fakeDeliverFirstSuperAdminToken(token: string): void {
  if (!firstSuperAdminHarnessEnabled()) throw new Error("P7 disabled");
  lastToken = token;
}
export function takeFakeFirstSuperAdminToken(): string | undefined {
  if (!firstSuperAdminHarnessEnabled()) throw new Error("P7 disabled");
  const token = lastToken; lastToken = undefined; return token;
}
