import { z } from "zod";

export const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const uuid = z.string().uuid();
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const application = z.object({ id: uuid, classId: uuid, childId: z.string(), quotedAmount: money, status: z.enum(["PENDING", "CONFIRMED", "CANCELLED"]), reservationId: uuid.optional() });
export const operatorSession = z.object({
  runId: uuid, scope: z.literal("OPERATOR"), csrf: token, expiresAt: z.number(), mode: z.enum(["MOCK_ONLY", "DATABASE"]),
  data: z.object({
    children: z.record(z.object({ id: z.string(), active: z.boolean() })),
    classes: z.record(z.object({ id: uuid, capacity: z.number(), teacherIds: z.array(z.string()), quotedAmount: money, startsAt: z.number(), endsAt: z.number(), status: z.enum(["SCHEDULED", "CANCELLED"]) })),
    applications: z.record(application),
    deposits: z.array(z.object({ id: uuid, applicationId: uuid, amount: money })),
    reservations: z.record(z.object({ id: uuid, applicationId: uuid, classId: uuid, childId: z.string(), status: z.enum(["RESERVED", "CANCELLED", "NO_SHOW"]), attendance: z.enum(["PRESENT", "ABSENT"]).optional() })),
    payments: z.record(z.object({ id: uuid, reservationId: uuid, amount: money, refundedAmount: money, status: z.enum(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]) })),
    refunds: z.array(z.object({ id: uuid, paymentId: uuid, amount: money, reason: z.string(), detail: z.string().optional() })),
  }),
});
export const ownApplication = z.object({ id: uuid, childId: z.string().regex(/^child-(?:[1-9]|1[0-2])$/), status: z.enum(["PENDING", "CONFIRMED", "CANCELLED"]) });
export const submissionResult = z.object({ applicationId: uuid, status: z.literal("PENDING"), applications: z.array(ownApplication).min(1) });
export const reservationSession = z.object({ runId: uuid, scope: z.literal("RESERVATION"), csrf: token, expiresAt: z.number(), classStatus: z.enum(["SCHEDULED", "CANCELLED"]), applications: z.array(ownApplication), application: z.object({ id: uuid, status: z.enum(["PENDING", "CONFIRMED", "CANCELLED"]) }).nullable() });
export const revenueSchema = z.object({ gross: money, refunds: money, net: z.number().int() });
export const csrfSchema = z.object({ csrf: token });
export const bootstrapResult = csrfSchema.extend({ runId: uuid, expiresAt: z.number(), mode: z.enum(["MOCK_ONLY", "DATABASE"]) });
export const linkResult = z.object({ runId: uuid, grant: token, expiresAt: z.number() });
export const closedResult = csrfSchema.extend({ runId: uuid, status: z.literal("CLOSED") });
export const cleanedResult = z.object({ runId: uuid, status: z.literal("CLEANED") });
export type OperatorSession = z.infer<typeof operatorSession>;
export type ReservationSession = z.infer<typeof reservationSession>;
export type Revenue = z.infer<typeof revenueSchema>;
type Endpoint = "csrf" | "bootstrap" | "session" | "classes" | "links" | "exchange" | "submission" | "deposit" | "confirm" | "cancel" | "payment" | "refunds" | "revenue" | "close" | "cleanup";

export class ManualClientError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return "TEST input or response is invalid. Check the selected fixtures, whole KRW amounts, and class dates.";
  if (!(error instanceof ManualClientError)) return "TEST request could not be verified. Check your connection and retry.";
  if (error.code === "MOCK_RUNTIME_DISABLED") return "TEST runtime is disabled. An operator must configure the isolated database on a non-production HTTPS environment.";
  if (error.status === 401) return "TEST session or link is invalid, expired, consumed, or closed. Request a new link or start a new test.";
  const known: Record<string, string> = {
    ORIGIN_DENIED: "TEST requests require the configured same-origin HTTPS environment.",
    CSRF_DENIED: "TEST security token expired. Refresh the session before retrying.",
    CHILD_INACTIVE: "TEST child-12 is inactive. Confirmation is intentionally blocked.",
    OVERBOOKING_CONFIRMATION_REQUIRED: "TEST capacity reached. Explicitly approve overbooking before confirming.",
    INSUFFICIENT_DEPOSIT: "TEST deposit is below the quoted amount.",
    DUPLICATE_RESERVATION: "TEST child already has a reservation for this class.",
    OVER_REFUND: "TEST refund exceeds the remaining payment amount.",
    ALREADY_SUBMITTED: "TEST application already submitted. Refresh its status.",
    INVALID_INPUT: "TEST input is invalid. Check amounts, dates, and selected fixtures.",
    CLASS_TIME_INVALID: "TEST class must start in the future and end after it starts.",
  };
  return known[error.code] ?? `TEST request rejected (${error.code.replace(/[^A-Z0-9_]/g, "") || "UNKNOWN"}). Refresh and check the selected record.`;
}

/** Only fixed same-origin mock endpoints are reachable; credentials and grants stay in memory. */
export async function manualRequest<T>(endpoint: Endpoint, schema: z.ZodType<T>, options: { body?: unknown; csrf?: string; query?: Record<string, string> } = {}): Promise<T> {
  const query = options.query ? `?${new URLSearchParams(options.query)}` : "";
  const response = await fetch(`/api/manual-test/${endpoint}${query}`, {
    method: options.body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json", ...(options.csrf ? { "x-manual-test-csrf": token.parse(options.csrf) } : {}) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(value);
    throw new ManualClientError(parsed.success ? parsed.data.error : "INVALID_RESPONSE", response.status);
  }
  return schema.parse(value);
}

export function readReservationLocation(href: string) {
  const url = new URL(href);
  const params = [...url.searchParams.keys()];
  if (params.length !== 1 || params[0] !== "runId") throw new Error("Invalid TEST link");
  return { runId: uuid.parse(url.searchParams.get("runId")), grant: url.hash ? token.parse(url.hash.slice(1)) : null };
}
export function reservationUrl(origin: string, runId: string, grant: string) {
  const url = new URL("/manual-test/reserve", origin);
  url.searchParams.set("runId", uuid.parse(runId));
  url.hash = token.parse(grant);
  return url.href;
}

/** Retain a request key across uncertain failures; discard only on a verified success. */
export class RetryKeys {
  private readonly keys = new Map<string, string>();
  key(operation: string, body: unknown) {
    const identity = JSON.stringify([operation, body]);
    let key = this.keys.get(identity);
    if (!key) { key = crypto.randomUUID(); this.keys.set(identity, key); }
    return key;
  }
  done(operation: string, body: unknown) { this.keys.delete(JSON.stringify([operation, body])); }
}
export const krw = (amount: number) => `${amount.toLocaleString("ko-KR")} KRW`;
export const kst = (timestamp: number) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(timestamp) + " KST";
