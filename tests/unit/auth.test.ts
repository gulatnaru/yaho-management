import { describe, expect, it } from "vitest";
import { isAdmin } from "@/lib/auth/roles";
import { credentialsSchema } from "@/lib/validation/auth";

describe("credentialsSchema", () => {
  it("accepts an operator email and sufficiently long password", () => {
    expect(credentialsSchema.safeParse({ email: "admin@yaho.test", password: "secure-password" }).success).toBe(true);
  });

  it("rejects an invalid login payload", () => {
    expect(credentialsSchema.safeParse({ email: "not-an-email", password: "short" }).success).toBe(false);
  });
});

describe("isAdmin", () => {
  it("allows only ADMIN users", () => {
    expect(isAdmin({ id: "admin", role: "ADMIN" })).toBe(true);
    expect(isAdmin({ id: "teacher", role: "TEACHER" })).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});
