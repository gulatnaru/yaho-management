import { describe, expect, it } from "vitest";
import { isAdmin, isOperationalRole, isUserRole } from "@/lib/auth/roles";
import { changeOwnPasswordSchema, credentialsSchema } from "@/lib/validation/auth";

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
    expect(isAdmin({ id: "manager", role: "MANAGER" })).toBe(false);
    expect(isAdmin({ id: "teacher", role: "TEACHER" })).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

describe("Phase 16 roles", () => {
  it("accepts exactly ADMIN, MANAGER, and TEACHER", () => {
    expect(isUserRole("ADMIN")).toBe(true);
    expect(isUserRole("MANAGER")).toBe(true);
    expect(isUserRole("TEACHER")).toBe(true);
    expect(isUserRole("OWNER")).toBe(false);
  });

  it("treats ADMIN and MANAGER as operational roles", () => {
    expect(isOperationalRole("ADMIN")).toBe(true);
    expect(isOperationalRole("MANAGER")).toBe(true);
    expect(isOperationalRole("TEACHER")).toBe(false);
  });
});

describe("changeOwnPasswordSchema", () => {
  it("accepts a matching new password", () => {
    expect(
      changeOwnPasswordSchema.safeParse({
        currentPassword: "old-password",
        newPassword: "new-password",
        confirmPassword: "new-password",
      }).success,
    ).toBe(true);
  });

  it("rejects mismatched confirmation and short passwords", () => {
    expect(
      changeOwnPasswordSchema.safeParse({
        currentPassword: "old-password",
        newPassword: "new-password",
        confirmPassword: "different-password",
      }).success,
    ).toBe(false);
    expect(
      changeOwnPasswordSchema.safeParse({
        currentPassword: "short",
        newPassword: "short",
        confirmPassword: "short",
      }).success,
    ).toBe(false);
  });
});
