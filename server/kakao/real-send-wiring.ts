import "server-only";
import { SolapiAdapter, type SolapiTransport } from "@/lib/kakao/providers/solapi";
import { SolapiLookupClient } from "@/server/kakao/lookup/solapi";
import { prepareRealDispatch } from "@/server/kakao/dispatch-prepare-real";
import { decryptActiveRecipientPhone } from "@/server/kakao/recipient-storage-real";
import type { PrismaDispatchRepository } from "@/server/kakao/dispatch-repository";
import type { OutboxBatchOptions } from "@/lib/kakao/outbox-worker";

// Real-send wiring: the only production creator of SolapiAdapter and
// SolapiLookupClient, and the only production module that calls the global
// fetch (inside createRealSolapiTransport below). No secret or recipient
// value is ever logged, stored, or placed in an error message here.

export type RealSendEnv = {
  apiKey: string; // KAKAO_SOLAPI_API_KEY, 1–128 chars
  apiSecret: string; // KAKAO_SOLAPI_API_SECRET, 1–256 chars
  pfId: string; // KAKAO_ALIMTALK_PF_ID, 1–128 chars
  templateId: string; // KAKAO_ALIMTALK_TEMPLATE_ID, 1–128 chars
  recipientKey: Buffer; // KAKAO_RECIPIENT_KEY, base64-decoded to exactly 32 bytes
};

export type RealSafe = NonNullable<OutboxBatchOptions["safe"]>;

function envField(value: unknown, min: number, max: number): string | null {
  return typeof value === "string" && value.length >= min && value.length <= max ? value : null;
}

/** Null on any missing or malformed key. No exceptions, no values in logs. */
export function readRealSendEnv(env: NodeJS.ProcessEnv): RealSendEnv | null {
  const apiKey = envField(env.KAKAO_SOLAPI_API_KEY, 1, 128);
  const apiSecret = envField(env.KAKAO_SOLAPI_API_SECRET, 1, 256);
  const pfId = envField(env.KAKAO_ALIMTALK_PF_ID, 1, 128);
  const templateId = envField(env.KAKAO_ALIMTALK_TEMPLATE_ID, 1, 128);
  const rawKey = env.KAKAO_RECIPIENT_KEY;
  if (!apiKey || !apiSecret || !pfId || !templateId || typeof rawKey !== "string" || !rawKey.length) return null;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(rawKey)) return null;
  const recipientKey = Buffer.from(rawKey, "base64");
  if (recipientKey.length !== 32) return null;
  return { apiKey, apiSecret, pfId, templateId, recipientKey };
}

/**
 * The only direct global fetch call in production code. A GET that arrives
 * with an empty body has the body omitted from the actual call (undici/Node
 * rejects GET + body). Headers and signal pass through; the response is
 * returned as {status, headers, json}. No logging of headers or body.
 */
export function createRealSolapiTransport(): SolapiTransport {
  return {
    async fetch(url, init) {
      const requestInit: RequestInit = { method: init.method, headers: init.headers, signal: init.signal };
      if (init.body !== "") requestInit.body = init.body;
      const response = await globalThis.fetch(url, requestInit);
      return { status: response.status, headers: response.headers, json: () => response.json() as Promise<unknown> };
    },
  };
}

/** Lookup client for the lookup action (stage 3E). Env is assumed already validated by readRealSendEnv. */
export function buildRealLookupClient(env: RealSendEnv, overrides?: { transport?: SolapiTransport }): SolapiLookupClient {
  return new SolapiLookupClient({
    transport: overrides?.transport ?? createRealSolapiTransport(),
    apiKey: env.apiKey,
    apiSecret: env.apiSecret,
    timeoutMs: 10_000,
  });
}

/**
 * Assembles the real safe for one dispatcher call. Null on any failed
 * precondition (no exceptions): no RuntimeConfig preview row / blocked /
 * activationEpoch missing or in the future / policyVersion or
 * costPolicyVersion !== "g4-v1" / templateVersion or recipientVersion missing
 * / keyVersion missing / decryption of the active recipient fails (which
 * itself requires exactly one active recipient and a
 * recipient_ownership_confirmed audit row). canIssue is attached by the
 * dispatcher, not here. The plaintext recipient number lives only in memory
 * for this call; it is never logged or stored.
 */
export async function buildRealSafe(
  repository: PrismaDispatchRepository,
  env: RealSendEnv,
  overrides?: { transport?: SolapiTransport }, // Test-only. Production callers omit it.
): Promise<Omit<RealSafe, "canIssue"> | null> {
  const now = new Date();
  const [runtime] = await repository.transaction(async (tx) => {
    return tx.$queryRaw<{ blocked: boolean; activationEpoch: Date | null; policyVersion: string | null; costPolicyVersion: string | null; templateVersion: string | null; recipientVersion: string | null; keyVersion: string | null }[]>`
      SELECT "blocked", "activationEpoch", "policyVersion", "costPolicyVersion", "templateVersion", "recipientVersion", "keyVersion"
      FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
  });
  if (!runtime || runtime.blocked || !runtime.activationEpoch || runtime.activationEpoch.getTime() > now.getTime()
    || runtime.policyVersion !== "g4-v1" || runtime.costPolicyVersion !== "g4-v1"
    || !runtime.templateVersion || !runtime.recipientVersion || !runtime.keyVersion) return null;
  const decrypted = await decryptActiveRecipientPhone(repository, { key: { keyVersion: runtime.keyVersion, key: env.recipientKey }, now });
  if (!decrypted) return null;
  const transport = overrides?.transport ?? createRealSolapiTransport();
  return {
    repository,
    prepare: (row) => prepareRealDispatch(repository, {
      rowId: row.id,
      claimToken: row.claimToken!,
      recipientKey: { keyVersion: runtime.keyVersion!, key: env.recipientKey },
      templateId: env.templateId,
    }),
    provider: new SolapiAdapter({ to: decrypted.to, pfId: env.pfId, templateId: env.templateId, apiKey: env.apiKey, apiSecret: env.apiSecret, timeoutMs: 10_000, transport }),
    clock: () => new Date(),
  };
}
