import "server-only";
import { z } from "zod";
import { dispatchPermitSchema, providerRefSchema, type ProviderResult } from "@/lib/kakao/send-contract";

const fixtureSchema = z.union([
  z.object({ code: z.literal("S_ACCEPTED"), ref: providerRefSchema }).strict(),
  z.object({ code: z.literal("S_PENDING"), accepted: z.literal(true), ref: providerRefSchema }).strict(),
  z.object({ code: z.literal("S_PENDING"), accepted: z.literal(false) }).strict(),
  z.object({ code: z.literal("S_REJECT_TEMP"), nonBillableEvidence: z.boolean() }).strict(),
  z.object({ code: z.literal("S_REJECT_PERM"), nonBillableEvidence: z.boolean() }).strict(),
  z.object({ code: z.literal("S_UNKNOWN") }).strict(),
  z.object({ code: z.literal("S_THROW") }).strict(),
  z.object({ code: z.literal("S_TIMEOUT") }).strict(),
]);
// Synthetic only: no HTTP, retry, fallback, lookup or external transport.
export class MockProvider {
  constructor(private readonly fixture: unknown) {}
  async send(permit: unknown): Promise<ProviderResult> {
    if (!dispatchPermitSchema.safeParse(permit).success) return { status: "unknown" };
    try {
      const parsed = fixtureSchema.safeParse(this.fixture);
      if (!parsed.success) return { status: "unknown" };
      const result = parsed.data;
      if (result.code === "S_ACCEPTED" || (result.code === "S_PENDING" && result.accepted)) return { status: "accepted", providerId: "solapi", ref: result.ref, phase: result.code === "S_PENDING" ? "awaiting_final" : "accepted" };
      if (result.code === "S_REJECT_TEMP" || result.code === "S_REJECT_PERM") return { status: "definite_rejection", retryable: result.code === "S_REJECT_TEMP", nonBillableEvidence: result.nonBillableEvidence };
      return { status: "unknown" };
    } catch { return { status: "unknown" }; }
  }
}
