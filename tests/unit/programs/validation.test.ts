import { describe, expect, it } from "vitest";
import { programInputSchema } from "@/lib/validation/program";

describe("programInputSchema", () => {
  it("passes with only a name and everything else empty", () => {
    const result = programInputSchema.safeParse({ name: "발레 A반" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("ACTIVE");
      expect(result.data.defaultPrice).toBe(0);
    }
  });

  it("rejects a blank name", () => {
    const result = programInputSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects targetAgeMin greater than targetAgeMax", () => {
    const result = programInputSchema.safeParse({ name: "발레 A반", targetAgeMin: "10", targetAgeMax: "5" });
    expect(result.success).toBe(false);
  });

  it("passes when only targetAgeMin is provided", () => {
    const result = programInputSchema.safeParse({ name: "발레 A반", targetAgeMin: "5" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetAgeMin).toBe(5);
      expect(result.data.targetAgeMax).toBeUndefined();
    }
  });

  it("passes when only targetAgeMax is provided", () => {
    const result = programInputSchema.safeParse({ name: "발레 A반", targetAgeMax: "8" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetAgeMax).toBe(8);
      expect(result.data.targetAgeMin).toBeUndefined();
    }
  });

  it("passes when targetAgeMin equals targetAgeMax", () => {
    const result = programInputSchema.safeParse({ name: "발레 A반", targetAgeMin: "7", targetAgeMax: "7" });
    expect(result.success).toBe(true);
  });

  it("rejects defaultDuration of 0", () => {
    const result = programInputSchema.safeParse({ name: "발레 A반", defaultDuration: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative defaultDuration", () => {
    const result = programInputSchema.safeParse({ name: "발레 A반", defaultDuration: "-10" });
    expect(result.success).toBe(false);
  });

  it("accepts a positive defaultDuration", () => {
    const result = programInputSchema.safeParse({ name: "발레 A반", defaultDuration: "60" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultDuration).toBe(60);
    }
  });

  it("rejects a negative defaultPrice", () => {
    const result = programInputSchema.safeParse({ name: "발레 A반", defaultPrice: "-1000" });
    expect(result.success).toBe(false);
  });

  it("treats an empty defaultPrice as 0", () => {
    const result = programInputSchema.safeParse({ name: "발레 A반", defaultPrice: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultPrice).toBe(0);
    }
  });

  it("defaults status to ACTIVE when omitted", () => {
    const result = programInputSchema.safeParse({ name: "발레 A반" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("ACTIVE");
    }
  });

  it("accepts an explicit INACTIVE status", () => {
    const result = programInputSchema.safeParse({ name: "발레 A반", status: "INACTIVE" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("INACTIVE");
    }
  });
});
