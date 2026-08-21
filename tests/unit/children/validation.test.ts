import { describe, expect, it } from "vitest";
import { childInputSchema } from "@/lib/validation/child";

describe("childInputSchema", () => {
  it("passes with only a name and everything else empty", () => {
    const result = childInputSchema.safeParse({ name: "김하윤" });
    expect(result.success).toBe(true);
  });

  it("rejects a blank name", () => {
    const result = childInputSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects a future birthDate", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const result = childInputSchema.safeParse({
      name: "김하윤",
      birthDate: future.toISOString().slice(0, 10),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a past birthDate", () => {
    const result = childInputSchema.safeParse({ name: "김하윤", birthDate: "2018-05-01" });
    expect(result.success).toBe(true);
  });

  it("accepts an empty birthDate", () => {
    const result = childInputSchema.safeParse({ name: "김하윤", birthDate: "" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed guardianPhone", () => {
    const result = childInputSchema.safeParse({ name: "김하윤", guardianPhone: "abc-defg" });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed guardianPhone", () => {
    const result = childInputSchema.safeParse({ name: "김하윤", guardianPhone: "010-1234-5678" });
    expect(result.success).toBe(true);
  });

  it("accepts an empty guardianPhone", () => {
    const result = childInputSchema.safeParse({ name: "김하윤", guardianPhone: "" });
    expect(result.success).toBe(true);
  });

  it("rejects a guardianPhone made only of hyphens", () => {
    const result = childInputSchema.safeParse({ name: "김하윤", guardianPhone: "---------" });
    expect(result.success).toBe(false);
  });

  it("accepts a guardianPhone with 9+ digits combined with hyphens", () => {
    const result = childInputSchema.safeParse({ name: "김하윤", guardianPhone: "010-123-4567" });
    expect(result.success).toBe(true);
  });

  it("rejects a guardianPhone with only 8 digits", () => {
    const result = childInputSchema.safeParse({ name: "김하윤", guardianPhone: "123-456-78" });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only guardianName", () => {
    const result = childInputSchema.safeParse({ name: "김하윤", guardianName: "   " });
    expect(result.success).toBe(false);
  });

  it("accepts an empty guardianName", () => {
    const result = childInputSchema.safeParse({ name: "김하윤", guardianName: "" });
    expect(result.success).toBe(true);
  });
});
