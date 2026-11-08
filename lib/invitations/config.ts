import "server-only";

/** Server-only configuration. No public environment variables or request headers are trusted. */
export type DeliveryConfig = { kind: "resend"; apiKey: string; sender: string; origin: string } | { kind: "fake"; origin: string } | { kind: "off" };

// Resend tracking is a domain setting, not a send parameter. The attestation
// requires both click and open tracking to be disabled at the provider.
export function deliveryConfig(env: Record<string, string | undefined> = process.env): DeliveryConfig {
  if (env.YAHO_INVITATION_DELIVERY === "fake") {
    // Harness conditions enforce production exclusion; NODE_ENV is not a security boundary here.
    // Approved port set (2026-11-08, Phase 21 + G4 Preview integration, user-approved
    // option A): the isolated harness runs on 55432 (G4 baseline cluster) and 55435
    // (the new isolated fresh-DB cluster for this integration branch). No other port
    // is allowed; anything else fails closed to "off". External and Production
    // databases are never accepted here.
    try {
      const db = new URL(env.DATABASE_URL ?? "");
      if (!env.VERCEL_ENV && env.YAHO_P4_ISOLATED_HARNESS === "1" && db.hostname === "127.0.0.1" && (db.port === "55432" || db.port === "55435") && db.pathname === "/yaho_e2e" && db.username === "yaho_e2e") {
        return { kind: "fake", origin: "https://example.test" };
      }
    } catch { /* fail closed */ }
    return { kind: "off" };
  }
  if (env.YAHO_INVITATION_DELIVERY !== "resend" || env.YAHO_INVITATION_REAL_SEND_APPROVED !== "1" || env.YAHO_INVITATION_RESEND_ACCOUNT_APPROVED !== "1" || env.YAHO_INVITATION_TRACKING_DISABLED !== "1" || env.YAHO_INVITATION_MIGRATION_DEPLOY_APPROVED !== "1" || env.YAHO_INVITATION_DOMAIN_AUTHENTICATED !== "1" || env.YAHO_INVITATION_SENDER_APPROVED !== "1" || env.YAHO_INVITATION_ORIGIN_APPROVED !== "1" || !env.RESEND_API_KEY || !/^re_[A-Za-z0-9]+$/.test(env.RESEND_API_KEY) || !env.YAHO_INVITATION_SENDER || !env.YAHO_INVITATION_SENDING_DOMAIN || !env.YAHO_INVITATION_ORIGIN) return { kind: "off" };
  try {
    const url = new URL(env.YAHO_INVITATION_ORIGIN);
    if (!/^[a-z0-9.-]+$/.test(env.YAHO_INVITATION_SENDING_DOMAIN) || env.YAHO_INVITATION_SENDER.split("@")[1]?.toLowerCase() !== env.YAHO_INVITATION_SENDING_DOMAIN || url.protocol !== "https:" || url.origin !== env.YAHO_INVITATION_ORIGIN || url.username || url.password || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(env.YAHO_INVITATION_SENDER)) return { kind: "off" };
    return { kind: "resend", apiKey: env.RESEND_API_KEY, sender: env.YAHO_INVITATION_SENDER, origin: url.origin };
  } catch { return { kind: "off" }; }
}

export function invitationUseEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const config = deliveryConfig(env);
  return config.kind === "fake" || (config.kind === "resend" && env.YAHO_INVITATION_USE_TRANSITION_APPROVED === "1");
}
