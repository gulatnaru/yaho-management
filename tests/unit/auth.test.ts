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
  it("accepts exactly SUPER_ADMIN, ADMIN, MANAGER, TEACHER, and STAFF", () => {
    expect(isUserRole("SUPER_ADMIN")).toBe(true);
    expect(isUserRole("ADMIN")).toBe(true);
    expect(isUserRole("MANAGER")).toBe(true);
    expect(isUserRole("TEACHER")).toBe(true);
    expect(isUserRole("STAFF")).toBe(true);
    expect(isUserRole("OWNER")).toBe(false);
  });

  it("treats SUPER_ADMIN, ADMIN, and MANAGER as operational roles (explicit enumeration)", () => {
    expect(isOperationalRole("SUPER_ADMIN")).toBe(true);
    expect(isOperationalRole("ADMIN")).toBe(true);
    expect(isOperationalRole("MANAGER")).toBe(true);
    expect(isOperationalRole("TEACHER")).toBe(false);
    // P1: STAFF는 열거에 포함되지 않아 deny-by-default다.
    expect(isOperationalRole("STAFF")).toBe(false);
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
