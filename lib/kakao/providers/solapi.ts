import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { dispatchPermitSchema, providerRefSchema, type ProviderResult } from "@/lib/kakao/send-contract";

// Solapi REST adapter (direct HMAC implementation). No production transport
// exists in this codebase: the adapter only ever calls the injected
// SolapiTransport, so its mere presence cannot send anything.
export function buildSolapiAuthorization(input: { apiKey: string; apiSecret: string; date: string; salt: string }): string {
  const signature = createHmac("sha256", input.apiSecret).update(`${input.date}${input.salt}`).digest("hex");
  return `HMAC-SHA256 apiKey=${input.apiKey}, date=${input.date}, salt=${input.salt}, signature=${signature}`;
}

export interface SolapiTransportResponse {
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export interface SolapiTransport {
  fetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
  ): Promise<SolapiTransportResponse>;
}

export interface SolapiClock {
  now(): Date;
  randomBytes(n: number): Buffer;
}

const solapiAdapterConfigSchema = z.object({
  transport: z.custom<SolapiTransport>((value) => typeof (value as SolapiTransport | null)?.fetch === "function", "transport.fetch is required"),
  apiKey: z.string().min(1).max(128),
  apiSecret: z.string().min(1).max(256),
  pfId: z.string().min(1).max(128),
  templateId: z.string().min(1).max(128),
  // Recipient phone number, supplied by the caller (the E-06-verified admin
  // number at activation time). The dispatch permit carries no phone number,
  // so the adapter cannot read it from the permit. Validated at send time
  // (normalise + /^[0-9]{9,15}$/) per PLAN §3.3.
  to: z.string().min(1).max(32),
  timeoutMs: z.number().int().positive().default(10_000),
  clock: z.custom<SolapiClock>((value) => typeof (value as SolapiClock | null)?.now === "function" && typeof (value as SolapiClock | null)?.randomBytes === "function").optional(),
}).strict();
export type SolapiAdapterConfig = z.input<typeof solapiAdapterConfigSchema>;
type SolapiAdapterConfigResolved = z.output<typeof solapiAdapterConfigSchema>;

const solapiMessageItemSchema = z.object({ to: z.string(), messageId: z.string(), statusCode: z.string() }).passthrough();
const solapiSendResponseSchema = z.object({
  groupInfo: z.object({ groupId: z.string() }).passthrough(),
  failedMessageList: z.array(solapiMessageItemSchema).optional().default([]),
  messageList: z.array(solapiMessageItemSchema).optional().default([]),
}).strict();

const DEFINITE_REJECTION_CODES = new Set([
  "1010", "1011", "1042", "1043", "1057", "1157", "3010", "3013", "3103", "3105", "3117",
  "1026", "1069", "1030", "1031", "3107", "3108", "3040", "3063",
]);

const SEND_URL = "https://api.solapi.com/messages/v4/send-many/detail";

export class SolapiAdapter {
  private readonly config: SolapiAdapterConfigResolved;

  constructor(config: SolapiAdapterConfig) {
    // Throws on invalid configuration: fail-closed, the adapter cannot be
    // constructed without an explicit transport and real settings.
    this.config = solapiAdapterConfigSchema.parse(config);
  }

  async send(permit: unknown): Promise<ProviderResult> {
    const parsed = dispatchPermitSchema.safeParse(permit);
    if (!parsed.success) return { status: "unknown" };
    const context = parsed.data.context;
    if (context.templateId === "mock_application_received_v1" || context.templateId !== this.config.templateId) {
      return { status: "unknown", code: "provider_config_error" };
    }
    if (Object.keys(context.variables).some((name) => name.includes("."))) {
      return { status: "unknown", code: "template_invalid" };
    }
    const to = this.config.to.replace(/[-\s]/g, "");
    if (!/^[0-9]{9,15}$/.test(to)) return { status: "unknown", code: "recipient_invalid" };
    const variables: Record<string, string> = {};
    for (const [name, value] of Object.entries(context.variables)) variables[`#{${name}}`] = value;
    const body = {
      messages: [
        {
          to,
          type: "ATA",
          country: "82",
          kakaoOptions: { pfId: this.config.pfId, templateId: this.config.templateId, variables, disableSms: true },
        },
      ],
      strict: true,
      allowDuplicates: false,
      showMessageList: true,
    };
    const date = (this.config.clock?.now() ?? new Date()).toISOString();
    const salt = (this.config.clock ? this.config.clock.randomBytes(16) : randomBytes(16)).toString("hex");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.config.transport.fetch(SEND_URL, {
        method: "POST",
        headers: { Authorization: buildSolapiAuthorization({ apiKey: this.config.apiKey, apiSecret: this.config.apiSecret, date, salt }), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status === 403) return { status: "unknown", code: "provider_auth_error" };
      if (response.status === 429) return { status: "unknown", code: "provider_rate_limited" };
      if (response.status >= 500) return { status: "unknown", code: "provider_error" };
      if (response.status !== 200) return { status: "unknown", code: "provider_result_unknown" };
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { status: "unknown", code: "provider_result_unknown" };
      }
      const parsedBody = solapiSendResponseSchema.safeParse(payload);
      if (!parsedBody.success) return { status: "unknown", code: "provider_result_unknown" };
      const failed = parsedBody.data.failedMessageList.find((item) => item.to === to);
      if (failed) {
        if (DEFINITE_REJECTION_CODES.has(failed.statusCode)) {
          return { status: "definite_rejection", retryable: false, nonBillableEvidence: false };
        }
        return { status: "unknown", code: "provider_result_unknown" };
      }
      const accepted = parsedBody.data.messageList.find((item) => item.to === to);
      if (!accepted) return { status: "unknown", code: "provider_result_unknown" };
      if (accepted.statusCode !== "2000") return { status: "unknown", code: "provider_result_unknown" };
      if (!providerRefSchema.safeParse(accepted.messageId).success) return { status: "unknown", code: "provider_result_unknown" };
      return { status: "accepted", providerId: "solapi", ref: accepted.messageId, phase: "awaiting_final" };
    } catch {
      if (controller.signal.aborted) return { status: "unknown", code: "provider_timeout" };
      return { status: "unknown", code: "provider_error" };
    } finally {
      clearTimeout(timer);
    }
  }
}
