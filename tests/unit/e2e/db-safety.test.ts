import { describe, expect, it } from "vitest";
import { assertSafeE2eDatabaseUrl, assertSafeE2eDatabaseUrls } from "@/tests/e2e/support/db-safety";

const safeUrl = "postgresql://yaho_e2e:not-a-real-password@127.0.0.1:55432/yaho_e2e";

describe("Playwright database safety guard", () => {
  it("rejects missing DATABASE_URL or DIRECT_URL", () => {
    expect(() => assertSafeE2eDatabaseUrls({})).toThrowError("DATABASE_URL is missing");
    expect(() => assertSafeE2eDatabaseUrls({ DATABASE_URL: safeUrl })).toThrowError("DIRECT_URL is missing");
  });

  it("rejects an external Preview-shaped URL without connecting to it", () => {
    const password = "DO_NOT_LEAK_THIS_VALUE";
    const externalUrl = `postgresql://preview_user:${password}@db.preview.example.invalid:5432/preview`;

    let message = "";
    try {
      assertSafeE2eDatabaseUrl("DATABASE_URL", externalUrl);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("not the dedicated local E2E database");
    expect(message).toContain("host=db.preview.example.invalid");
    expect(message).not.toContain(password);
  });

  it("rejects a localhost URL for another database", () => {
    expect(() =>
      assertSafeE2eDatabaseUrl(
        "DATABASE_URL",
        "postgresql://yaho_e2e:not-a-real-password@localhost:55432/yaho_preview",
      ),
    ).toThrowError("database=yaho_preview");
  });

  it("rejects a localhost URL on another port", () => {
    expect(() =>
      assertSafeE2eDatabaseUrl(
        "DATABASE_URL",
        "postgresql://yaho_e2e:not-a-real-password@localhost:5432/yaho_e2e",
      ),
    ).toThrowError("port=5432");
  });

  it("allows both dedicated local E2E URLs", () => {
    expect(
      assertSafeE2eDatabaseUrls({
        DATABASE_URL: safeUrl,
        DIRECT_URL: "postgres://yaho_e2e:not-a-real-password@localhost:55432/yaho_e2e?schema=public",
      }),
    ).toEqual({
      DATABASE_URL: { host: "127.0.0.1", port: "55432", database: "yaho_e2e", user: "yaho_e2e" },
      DIRECT_URL: { host: "localhost", port: "55432", database: "yaho_e2e", user: "yaho_e2e" },
    });
  });
});
