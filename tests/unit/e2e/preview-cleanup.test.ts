import { describe, expect, it } from "vitest";
import { cleanupPreviewRun, PreviewRunCleanupError, runWithPreviewCleanup, type PreviewCleanupClient } from "@/lib/e2e/preview-cleanup";

function fixture(persist = false): { client: PreviewCleanupClient; deleted: string[] } {
  let active = true;
  const deleted: string[] = [];
  const delegate = (name: string) => ({
    findMany: async () => active ? [{ id: `run-${name}` }] : [],
    deleteMany: async () => { deleted.push(name); if (!persist) active = false; return { count: 1 }; },
  });
  const client = {
    program: delegate("program"), teacher: delegate("teacher"), classSchedule: delegate("class"), classTeacher: delegate("classTeacher"),
    child: delegate("child"), childSafetyInfo: delegate("safety"), reservation: delegate("reservation"),
    childConsent: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    relationship: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    $queryRaw: async () => [],
  } as unknown as PreviewCleanupClient;
  client.$transaction = async (callback) => callback(client);
  return { client, deleted };
}

describe("Preview E2E wrapper cleanup", () => {
  it("locks roots and removes only run-scoped resources in FK order", async () => {
    const { client, deleted } = fixture();
    await expect(cleanupPreviewRun(client, "preview-run-1")).resolves.toMatchObject({ runId: "preview-run-1" });
    expect(deleted).toEqual(["reservation", "safety", "classTeacher", "class", "child", "teacher", "program"]);
  });

  it("reports an identifiable run when cleanup leaves residual rows", async () => {
    const { client } = fixture(true);
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

  it("reports the run ID even when an ordinary cleanup error is not classified", async () => {
    let report: { runId: string } | undefined;
    await expect(runWithPreviewCleanup({
      runId: "preview-network-run",
      run: async () => undefined,
      cleanup: async () => { throw new Error("network failure"); },
      onCleanupFailure: (value) => { report = value; },
    })).rejects.toThrow("network failure");
    expect(report).toMatchObject({ runId: "preview-network-run" });
  });
});
