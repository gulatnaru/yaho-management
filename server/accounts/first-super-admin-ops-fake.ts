/** Strictly local disposable database only. No P7 or P4 harness flags are reused. */
export function opsFakeEnabled(): boolean {
  if (process.env.VERCEL_ENV || !["development", "test"].includes(process.env.NODE_ENV ?? "")) return false;
  try {
    return [process.env.DATABASE_URL, process.env.DIRECT_URL].every(value => {
      const url = new URL(value ?? "");
      return ["postgres:", "postgresql:"].includes(url.protocol) && ["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "55432" && url.pathname === "/yaho_e2e" && url.username === "yaho_e2e";
    });
  } catch { return false; }
}
let lastToken: string | undefined;
export function deliverOpsFake(token: string): void {
  if (!opsFakeEnabled()) throw new Error("P7_OPS_FAKE_DISABLED");
  lastToken = token;
}
export function takeOpsFake(): string | undefined {
  if (!opsFakeEnabled()) throw new Error("P7_OPS_FAKE_DISABLED");
  const token = lastToken; lastToken = undefined; return token;
}
