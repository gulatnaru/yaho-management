import { describe, expect, it } from "vitest";
import { childConsentInputSchema } from "@/lib/children/consent/validation";

describe("child consent input", () => {
  it("accepts every consent type and action", () => {
    expect(childConsentInputSchema.safeParse({ consentType: "PHOTO_MARKETING", action: "REVOKED" }).success).toBe(true);
  });

  it("rejects unknown consent values", () => {
    expect(childConsentInputSchema.safeParse({ consentType: "UNKNOWN", action: "AGREED" }).success).toBe(false);
  });
});
