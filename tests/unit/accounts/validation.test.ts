import { describe, expect, it } from "vitest";
import {
  accountCreateSchema,
  accountUpdateSchema,
  adminPasswordResetSchema,
  changeOwnPasswordSchema,
} from "@/lib/validation/accounts";

const baseCreate = {
  name: "운영자",
  email: "operator@example.test",
  role: "MANAGER",
  teacherId: null,
  isActive: true,
  temporaryPassword: "temporary-password",
} as const;

describe("account validation", () => {
  it("accepts ADMIN and MANAGER only without a Teacher link", () => {
    expect(accountCreateSchema.parse({ ...baseCreate, role: "ADMIN" }).teacherId).toBeNull();
    expect(accountCreateSchema.parse(baseCreate).role).toBe("MANAGER");
  });

  it("requires a Teacher link only for TEACHER", () => {
    const missing = accountCreateSchema.safeParse({ ...baseCreate, role: "TEACHER" });
    const linked = accountCreateSchema.safeParse({ ...baseCreate, role: "TEACHER", teacherId: "teacher-1" });
    const forbidden = accountCreateSchema.safeParse({ ...baseCreate, role: "ADMIN", teacherId: "teacher-1" });

    expect(missing.success).toBe(false);
    expect(linked.success).toBe(true);
    expect(forbidden.success).toBe(false);
  });

  it("trims account identity fields and rejects invalid roles", () => {
    const parsed = accountCreateSchema.parse({ ...baseCreate, name: "  운영자  ", email: "  op@example.test " });
    expect(parsed.name).toBe("운영자");
    expect(parsed.email).toBe("op@example.test");
    expect(accountCreateSchema.safeParse({ ...baseCreate, role: "OWNER" }).success).toBe(false);
  });

  it("applies the existing 8-128 password bounds to temporary passwords", () => {
    expect(adminPasswordResetSchema.safeParse({ temporaryPassword: "short" }).success).toBe(false);
    expect(adminPasswordResetSchema.safeParse({ temporaryPassword: "12345678" }).success).toBe(true);
    expect(adminPasswordResetSchema.safeParse({ temporaryPassword: "x".repeat(129) }).success).toBe(false);
  });

  it("uses the same role and Teacher rules for account updates", () => {
    const result = accountUpdateSchema.safeParse({
      name: "선생님 계정",
      email: "teacher@example.test",
      role: "TEACHER",
      teacherId: null,
      isActive: true,
    });
    expect(result.success).toBe(false);
  });

  it("requires matching new passwords for the shared self-change contract", () => {
    expect(changeOwnPasswordSchema.safeParse({
      currentPassword: "current-password",
      newPassword: "new-password",
      confirmPassword: "different-password",
    }).success).toBe(false);
    expect(changeOwnPasswordSchema.safeParse({
      currentPassword: "current-password",
      newPassword: "new-password",
      confirmPassword: "new-password",
    }).success).toBe(true);
  });
});
