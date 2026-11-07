import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { providerRefSchema } from "@/lib/kakao/send-contract";
import { buildSolapiAuthorization, type SolapiClock, type SolapiTransport } from "@/lib/kakao/providers/solapi";
import type { LookupProvider, MockLookupResult } from "@/lib/kakao/providers/mock-lookup";

// Solapi delivery-lookup client. Lookup only: it never invokes a send.
const groupIdSchema = z.string().regex(/^G4V[0-9]{14}[0-9A-Za-z]{15}$/);
const lookupRequestSchema = z.object({ lookupId: z.string().min(1).max(128), slotId: z.string().min(1).max(128), ref: providerRefSchema }).strict();
const lookupItemSchema = z.object({ messageId: z.string(), statusCode: z.string().nullable() }).passthrough();
const messageListResponseSchema = z.object({ messageList: z.record(z.string(), lookupItemSchema) }).passthrough();
const groupInfoSchema = z.object({
  groupId: z.string(),
  status: z.enum(["PENDING", "SENDING", "SCHEDULED", "COMPLETE", "FAILED", "DELETED"]),
  count: z.object({ sentSuccess: z.number(), sentFailed: z.number(), sentPending: z.number(), sentReplacement: z.number(), refund: z.number(), registeredSuccess: z.number(), registeredFailed: z.number() }),
}).passthrough();
const groupResponseSchema = z.object({ groupInfo: groupInfoSchema }).passthrough();

export type SolapiGroupSummary = {
  groupId: string;
  status: "PENDING" | "SENDING" | "SCHEDULED" | "COMPLETE" | "FAILED" | "DELETED";
  counts: { sentSuccess: number; sentFailed: number; sentPending: number; sentReplacement: number; refund: number; registeredSuccess: number; registeredFailed: number };
};

const solapiLookupClientConfigSchema = z.object({
  transport: z.custom<SolapiTransport>((value) => typeof (value as SolapiTransport | null)?.fetch === "function", "transport.fetch is required"),
  apiKey: z.string().min(1).max(128),
  apiSecret: z.string().min(1).max(256),
  timeoutMs: z.number().int().positive().default(10_000),
  clock: z.custom<SolapiClock>((value) => typeof (value as SolapiClock | null)?.now === "function" && typeof (value as SolapiClock | null)?.randomBytes === "function").optional(),
}).strict();
export type SolapiLookupClientConfig = z.input<typeof solapiLookupClientConfigSchema>;
type SolapiLookupClientConfigResolved = z.output<typeof solapiLookupClientConfigSchema>;

function mapStatusCode(statusCode: string | null): "delivered" | "delivery_failed" | "unknown" {
  if (statusCode === "4000") return "delivered";
  // 3014 "알 수 없는 메시지 상태" / 3048 "Unknown Code": "unknown" evidence
  // must not confirm delivery_failed.
  if (statusCode === "3014" || statusCode === "3048") return "unknown";
  if (statusCode !== null && /^3\d{3}$/.test(statusCode) && statusCode !== "3000") return "delivery_failed";
  return "unknown";
}

export class SolapiLookupClient implements LookupProvider {
  private readonly config: SolapiLookupClientConfigResolved;

  constructor(config: SolapiLookupClientConfig) {
    // Throws on invalid configuration: fail-closed.
    this.config = solapiLookupClientConfigSchema.parse(config);
  }

  async lookup(value: unknown): Promise<MockLookupResult | null> {
    const parsed = lookupRequestSchema.safeParse(value);
    if (!parsed.success) return null;
    // Only the ref is used; lookupId/slotId are correlation values.
    return this.lookupByMessageId(parsed.data.ref);
  }

  async lookupByMessageId(messageId: string): Promise<MockLookupResult | null> {
    if (!providerRefSchema.safeParse(messageId).success) return null;
    const url = `https://api.solapi.com/messages/v4/list?messagesId=${encodeURIComponent(messageId)}`;
    const response = await this.get(url);
    if (!response) return null;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return null;
    }
    const parsed = messageListResponseSchema.safeParse(payload);
    if (!parsed.success) return null;
    const entry = parsed.data.messageList[messageId];
    if (!entry || entry.messageId !== messageId) return null;
    return { status: mapStatusCode(entry.statusCode), ref: messageId };
  }

  async lookupGroup(groupId: string): Promise<SolapiGroupSummary | null> {
    if (!groupIdSchema.safeParse(groupId).success) return null;
    const url = `https://api.solapi.com/messages/v4/groups/${encodeURIComponent(groupId)}`;
    const response = await this.get(url);
    if (!response) return null;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return null;
    }
    const parsed = groupResponseSchema.safeParse(payload);
    if (!parsed.success) return null;
    const info = parsed.data.groupInfo;
    return { groupId: info.groupId, status: info.status, counts: { ...info.count } };
  }

  private async get(url: string): Promise<{ status: number; json(): Promise<unknown> } | null> {
    const date = (this.config.clock?.now() ?? new Date()).toISOString();
    const salt = (this.config.clock ? this.config.clock.randomBytes(16) : randomBytes(16)).toString("hex");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.config.transport.fetch(url, {
        method: "GET",
        headers: { Authorization: buildSolapiAuthorization({ apiKey: this.config.apiKey, apiSecret: this.config.apiSecret, date, salt }) },
        body: "",
        signal: controller.signal,
      });
      if (response.status !== 200) return null;
      return response;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
