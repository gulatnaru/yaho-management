import { describe, expect, it } from "vitest";
import { writeJwtIdentity, writeSessionIdentity } from "@/lib/auth/session";

describe("Auth.js session identity", () => {
  it("stores only userId and authVersion as authorization inputs in the JWT", () => {
    const token = {
      id: "stale-id",
      role: "ADMIN",
      isActive: true,
      teacherId: "stale-teacher",
      mustChangePassword: false,
    };

    expect(writeJwtIdentity(token, { id: "user-1", authVersion: 4 })).toEqual({
      userId: "user-1",
      authVersion: 4,
    });
  });

  it("does not expose a cached role or account state through the session", () => {
    const session = {
      expires: "2099-01-01T00:00:00.000Z",
      user: {
        name: "운영자",
        id: "stale-user",
        authVersion: 1,
        role: "ADMIN",
        isActive: true,
        teacherId: "teacher-1",
        mustChangePassword: false,
      },
    };

    expect(writeSessionIdentity(session, { userId: "user-1", authVersion: 3 })).toEqual({
      expires: "2099-01-01T00:00:00.000Z",
      user: { name: "운영자", id: "user-1", authVersion: 3 },
    });
  });
});
