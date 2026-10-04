import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  classifyPreviewCleanupError,
  cleanupPreviewRun,
  PREVIEW_CLEANUP_FAILURE_CODE,
  PREVIEW_CLEANUP_TRANSACTION_OPTIONS,
  PreviewRunCleanupError,
  runWithPreviewCleanup,
  type PreviewCleanupClient,
} from "@/lib/e2e/preview-cleanup";

function fixture({ persist = false, networkCostMs = 0 }: { persist?: boolean; networkCostMs?: number } = {}) {
  let active = true;
  let elapsedMs = 0;
  let transactionOptions: typeof PREVIEW_CLEANUP_TRANSACTION_OPTIONS | undefined;
  const deleted: string[] = [];
  const request = () => {
    elapsedMs += networkCostMs;
    if (transactionOptions && elapsedMs > transactionOptions.timeout) {
      throw new Prisma.PrismaClientKnownRequestError("sensitive database diagnostic", {
        code: "P2028",
        clientVersion: "test",
      });
    }
  };
  const delegate = (name: string) => ({
    findMany: async () => { request(); return active ? [{ id: `run-${name}` }] : []; },
    deleteMany: async () => { request(); deleted.push(name); if (!persist) active = false; return { count: 1 }; },
  });
  const client = {
    program: delegate("program"), teacher: delegate("teacher"), classSchedule: delegate("class"), classTeacher: delegate("classTeacher"),
    child: delegate("child"), childSafetyInfo: delegate("safety"), reservation: delegate("reservation"),
    childConsent: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    relationship: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    $queryRaw: async () => { request(); return []; },
  } as unknown as PreviewCleanupClient;
  client.$transaction = async (callback, options) => {
    transactionOptions = options;
    return callback(client);
  };
  return { client, deleted, elapsedMs: () => elapsedMs, transactionOptions: () => transactionOptions };
}

describe("Preview E2E wrapper cleanup", () => {
  it("locks roots and removes only run-scoped resources in FK order", async () => {
    const { client, deleted, transactionOptions } = fixture();
    await expect(cleanupPreviewRun(client, "preview-run-1")).resolves.toMatchObject({ runId: "preview-run-1" });
    expect(deleted).toEqual(["reservation", "safety", "classTeacher", "class", "child", "teacher", "program"]);
    expect(transactionOptions()).toEqual(PREVIEW_CLEANUP_TRANSACTION_OPTIONS);
  });

  it("reports an identifiable run when cleanup leaves residual rows", async () => {
    const { client } = fixture({ persist: true });
    await expect(cleanupPreviewRun(client, "preview-run-2")).rejects.toMatchObject({
      name: PreviewRunCleanupError.name, report: { runId: "preview-run-2", marker: "E2E_P11_preview-run-2_" },
    });
  });

  it("aborts before deleting any root when a manual cascade dependent is found", async () => {
    const { client, deleted } = fixture();
    client.classTeacher.findMany = async (args: unknown) => {
      const value = args as { where?: Record<string, unknown> };
      return value.where?.teacherId ? [{ id: "owned" }] : [{ id: "owned" }, { id: "manual" }];
    };
    await expect(cleanupPreviewRun(client, "preview-blocked-run")).rejects.toMatchObject({
      name: PreviewRunCleanupError.name,
      report: { runId: "preview-blocked-run", remaining: { unownedClassTeachers: 1 } },
    });
    expect(deleted).toEqual([]);
  });

  it("treats consents and relationships as unowned cascade dependents", async () => {
    const { client, deleted } = fixture();
    client.childConsent.findMany = async () => [{ id: "manual-consent" }];
    client.relationship.findMany = async () => [{ id: "manual-relationship" }];
    await expect(cleanupPreviewRun(client, "preview-dependent-run")).rejects.toMatchObject({
      report: { remaining: { unownedConsents: 1, unownedRelationships: 1 } },
    });
    expect(deleted).toEqual([]);
  });

  it("runs cleanup after an interrupted child failure before propagating it", async () => {
    let cleaned = false;
    await expect(runWithPreviewCleanup({
      runId: "preview-run-3",
      run: async () => { throw new Error("child interrupted"); },
      cleanup: async () => { cleaned = true; return { runId: "preview-run-3", marker: "m", remaining: {} }; },
      onCleanupFailure: () => undefined,
    })).rejects.toThrow("child interrupted");
    expect(cleaned).toBe(true);
  });

  it("reports a fixed code and run ID without injected cleanup diagnostics", async () => {
    let report: { runId: string } | undefined;
    let code: string | undefined;
    let diagnostic: string | undefined;
    const pii = "preview-secret@example.test";
    await expect(runWithPreviewCleanup({
      runId: "preview-network-run",
      run: async () => undefined,
      cleanup: async () => { throw new Error(`network failure ${pii}`); },
      onCleanupFailure: (value) => {
        report = value.report;
        code = value.code;
        diagnostic = JSON.stringify(value);
      },
    })).rejects.toThrow(pii);
    expect(report).toMatchObject({ runId: "preview-network-run" });
    expect(code).toBe(PREVIEW_CLEANUP_FAILURE_CODE.CLEANUP_FAILED);
    expect(diagnostic).not.toContain(pii);
  });

  it("allows cumulative mocked network work above the Prisma default and below the cleanup budget", async () => {
    const { client, elapsedMs } = fixture({ networkCostMs: 1_200 });
    await expect(cleanupPreviewRun(client, "preview-network-budget")).resolves.toMatchObject({
      runId: "preview-network-budget",
    });
    expect(elapsedMs()).toBeGreaterThan(5_000);
    expect(elapsedMs()).toBeLessThan(PREVIEW_CLEANUP_TRANSACTION_OPTIONS.timeout);
  });

  it("propagates an over-budget actual Prisma P2028 and reports it once without exposing diagnostics", async () => {
    const { client } = fixture({ networkCostMs: 2_000 });
    let calls = 0;
    let failureCode: string | undefined;
    let failureReport: { runId: string } | undefined;

    await expect(runWithPreviewCleanup({
      runId: "preview-over-budget",
      run: async () => undefined,
      cleanup: () => cleanupPreviewRun(client, "preview-over-budget"),
      onCleanupFailure: (failure) => {
        calls += 1;
        failureCode = failure.code;
        failureReport = failure.report;
      },
    })).rejects.toMatchObject({ code: "P2028" });

    expect(calls).toBe(1);
    expect(failureCode).toBe(PREVIEW_CLEANUP_FAILURE_CODE.PRISMA_P2028);
    expect(failureReport).toMatchObject({ runId: "preview-over-budget" });
  });

  it("classifies only an actual Prisma P2028, never a lookalike error or its diagnostics", () => {
    const actual = new Prisma.PrismaClientKnownRequestError("private connection string", {
      code: "P2028",
      clientVersion: "test",
    });
    const lookalike = Object.assign(new Error("private connection string"), { code: "P2028" });

    expect(classifyPreviewCleanupError(actual)).toBe(PREVIEW_CLEANUP_FAILURE_CODE.PRISMA_P2028);
    expect(classifyPreviewCleanupError(lookalike)).toBe(PREVIEW_CLEANUP_FAILURE_CODE.CLEANUP_FAILED);
    expect(JSON.stringify({ code: classifyPreviewCleanupError(lookalike) })).not.toContain("private");
  });
});
