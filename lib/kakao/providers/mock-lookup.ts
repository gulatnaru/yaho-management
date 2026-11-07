import "server-only";
import { z } from "zod";
import { providerRefSchema } from "@/lib/kakao/send-contract";

const requestSchema = z.object({ lookupId: z.string().min(1).max(128), slotId: z.string().min(1).max(128), ref: providerRefSchema }).strict();
const fixtureSchema = z.object({ code: z.enum(["L_DELIVERED", "L_FAILED", "L_PENDING", "L_NOT_FOUND"]), ref: providerRefSchema }).strict();
export type MockLookupResult = { status: "delivered" | "delivery_failed" | "unknown"; ref: string };

/** G2 fixture only: no transport, fallback or hidden retry. */
export class MockLookupProvider {
  constructor(private readonly fixture: unknown) {}
  async lookup(value: unknown): Promise<MockLookupResult | null> {
    const request = requestSchema.safeParse(value); const fixture = fixtureSchema.safeParse(this.fixture);
    if (!request.success || !fixture.success || request.data.ref !== fixture.data.ref) return null;
    const status = fixture.data.code === "L_DELIVERED" ? "delivered" : fixture.data.code === "L_FAILED" ? "delivery_failed" : "unknown";
    return { status, ref: fixture.data.ref };
  }
}
