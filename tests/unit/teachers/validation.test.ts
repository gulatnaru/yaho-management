import { describe, expect, it } from "vitest";
import { teacherInputSchema } from "@/lib/validation/teacher";

describe("teacherInputSchema", () => {
  it("passes with only a name and everything else empty", () => {
    const result = teacherInputSchema.safeParse({ name: "김선생" });
    expect(result.success).toBe(true);
  });

  it("rejects a blank name", () => {
    const result = teacherInputSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed phone", () => {
    const result = teacherInputSchema.safeParse({ name: "김선생", phone: "abc-defg" });
    expect(result.success).toBe(false);
  });

  it("rejects a phone with fewer than 9 digits", () => {
    const result = teacherInputSchema.safeParse({ name: "김선생", phone: "123-456-78" });
    expect(result.success).toBe(false);
  });

  it("rejects a phone made only of hyphens", () => {
    const result = teacherInputSchema.safeParse({ name: "김선생", phone: "---------" });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed phone", () => {
    const result = teacherInputSchema.safeParse({ name: "김선생", phone: "010-1234-5678" });
    expect(result.success).toBe(true);
  });

  it("accepts an empty phone", () => {
    const result = teacherInputSchema.safeParse({ name: "김선생", phone: "" });
    expect(result.success).toBe(true);
  });
});
