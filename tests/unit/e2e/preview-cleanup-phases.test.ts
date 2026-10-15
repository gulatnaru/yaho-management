import { describe, it, expect, vi } from "vitest";
import { cleanupPreviewRunPhases } from "@/lib/e2e/preview-cleanup-phases";
import {
  withPreviewDatabaseLock,
  PREVIEW_E2E_BROWSER_GLOBAL_TIMEOUT_MS,
  PREVIEW_E2E_LOCK_TIMEOUT_MS,
  type PreviewDatabaseClient,
} from "@/lib/e2e/preview-runner";
import {
  PHASE21_PREVIEW_CLEANUP_OPTIONS,
  PREVIEW_E2E_STARTUP_ALLOWANCE_MS,
} from "@/lib/e2e/preview-budgets";
import { PREVIEW_CLEANUP_TRANSACTION_OPTIONS } from "@/lib/e2e/preview-cleanup";
import { PHASE20_PREVIEW_MAX_AGE_MS } from "@/lib/e2e/phase20-lease";
describe("Preview wrapper cleanup lifecycle", () => {
  it("runs AI before old phases and releases only after all pass", async () => {
    const events: string[] = [];
    const step = (name: string) => async () => {
      events.push(name);
      return { owned: 0 };
    };
    expect(
      await cleanupPreviewRunPhases({
        phase21: step("AI"),
        phase20: step("PHASE20"),
        legacy: step("LEGACY"),
        releaseLease: step("RELEASE"),
      }),
    ).toEqual({ owned: 0 });
    expect(events).toEqual(["AI", "PHASE20", "LEGACY", "RELEASE"]);
  });
  it.each(["AI", "PHASE20", "LEGACY"])(
    "still attempts every phase and preserves lease on %s failure",
    async (failed) => {
      const events: string[] = [];
      const release = vi.fn();
      const step = (name: string) => async () => {
        events.push(name);
        if (name === failed) throw new Error("RAW_DIAGNOSTIC_SENTINEL");
      };
      await expect(
        cleanupPreviewRunPhases({
          phase21: step("AI"),
          phase20: step("PHASE20"),
          legacy: step("LEGACY"),
          releaseLease: release,
        }),
      ).rejects.toThrow(/^PREVIEW_CLEANUP_PHASE_FAILED$/);
      expect(events).toEqual(["AI", "PHASE20", "LEGACY"]);
      expect(release).not.toHaveBeenCalled();
    },
  );
  it("a global lock transaction commit failure rolls lease deletion back", async () => {
    let leasePresent = true;
    const query = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("");
      if (sql.includes("pg_try_advisory")) return [{ acquired: true }];
      if (sql.includes("DELETE")) {
        leasePresent = false;
        return [{ id: "lease" }];
      }
      return [];
    });
    const client = {
      $transaction: async (
        fn: (session: { $queryRaw: typeof query }) => Promise<unknown>,
      ) => {
        const before = leasePresent;
        try {
          await fn({ $queryRaw: query });
          throw new Error("COMMIT_FAILURE");
        } catch (error) {
          leasePresent = before;
          throw error;
        }
      },
    } as unknown as PreviewDatabaseClient;
    await expect(
      withPreviewDatabaseLock({
        client,
        onSessionLost: vi.fn(),
        run: (session) =>
          cleanupPreviewRunPhases({
            phase21: async () => {},
            phase20: async () => {},
            legacy: async () => ({ owned: 0 }),
            releaseLease: () =>
              session.$queryRaw`DELETE FROM "PreviewE2eRunLease" RETURNING "id"`,
          }),
      }),
    ).rejects.toThrow("COMMIT_FAILURE");
    expect(
      query.mock.calls.some(([strings]) => strings.join("").includes("DELETE")),
    ).toBe(true);
    expect(leasePresent).toBe(true);
  });
  it("cleanup/startup/acquisition budgets fit global lock without extending browser/intake", () => {
    const legacy = PREVIEW_CLEANUP_TRANSACTION_OPTIONS;
    const required =
      PREVIEW_E2E_BROWSER_GLOBAL_TIMEOUT_MS +
      PREVIEW_E2E_STARTUP_ALLOWANCE_MS +
      2 * (legacy.timeout + legacy.maxWait) +
      PHASE21_PREVIEW_CLEANUP_OPTIONS.timeout +
      PHASE21_PREVIEW_CLEANUP_OPTIONS.maxWait;
    expect(PREVIEW_E2E_LOCK_TIMEOUT_MS).toBeGreaterThan(required);
    expect(PREVIEW_E2E_BROWSER_GLOBAL_TIMEOUT_MS).toBe(22 * 60_000);
    expect(PHASE20_PREVIEW_MAX_AGE_MS).toBe(24 * 60_000);
  });
});
