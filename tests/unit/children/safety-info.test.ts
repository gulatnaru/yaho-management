import { describe, expect, it } from "vitest";
import { childSafetyInfoInputSchema } from "@/lib/children/safety-info/validation";

describe("child safety info input", () => {
  it("normalizes blank optional fields", () => {
    const result = childSafetyInfoInputSchema.parse({ allergies: "", emergencyNotes: "  " });
    expect(result.allergies).toBeUndefined();
    expect(result.emergencyNotes).toBeUndefined();
  });

  it("limits sensitive field length", () => {
    expect(childSafetyInfoInputSchema.safeParse({ allergies: "a".repeat(2001) }).success).toBe(false);
  });
});
