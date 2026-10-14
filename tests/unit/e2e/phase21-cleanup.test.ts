import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  cleanupPhase21PreviewRun,
  assertPhase21OwnedManifest,
} from "@/lib/e2e/phase21-cleanup";
import { SYNTHETIC_FACTS } from "@/server/ai-consultations/tools";
const runId = "preview-abcdefghijklmnopqrstuv";
const sha = "a".repeat(40);
const other = "preview-vutsrqponmlkjihgfedcba";
const uuid = "00000000-0000-4000-8000-000000000001";
const manifest = {
  version: 1 as const,
  programIds: ["ai-program-" + runId + "-" + uuid],
  classIds: ["ai-class-" + runId + "-" + uuid],
  subjectIds: ["synthetic-" + runId.slice(8) + "-000000000001"],
};
type Row = Record<string, unknown>;
const aiTables = [
  "aiConsultation",
  "aiQuotaBucket",
  "aiRetentionJob",
  "aiKnowledgeEntry",
  "aiClassPublication",
  "aiProgramPublication",
] as const;
type Table = (typeof aiTables)[number] | "program" | "classSchedule";
function match(row: Row, where: Row) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object") {
      if ("in" in value) return (value.in as unknown[]).includes(row[key]);
      if ("not" in value) return row[key] !== value.not;
      if ("startsWith" in value)
        return String(row[key]).startsWith(String(value.startsWith));
    }
    return row[key] === value;
  });
}
function fixture() {
  let state: {
    tables: Record<Table, Row[]>;
    lease: Row | null;
    metrics: Row[];
  } = {
    tables: {
      program: [
        {
          id: manifest.programIds[0],
          name: SYNTHETIC_FACTS.name,
          description: SYNTHETIC_FACTS.description,
          targetAgeMin: 5,
          targetAgeMax: 8,
        },
        { id: "foreign-program", name: "EXISTING" },
      ],
      classSchedule: [
        {
          id: manifest.classIds[0],
          programId: manifest.programIds[0],
          location: SYNTHETIC_FACTS.location,
        },
        {
          id: "foreign-class",
          programId: "foreign-program",
          location: "EXISTING",
        },
      ],
      aiConsultation: [
        { id: "own-question", runId, origin: "SYNTHETIC" },
        { id: "foreign-question", runId: other, origin: "SYNTHETIC" },
      ],
      aiQuotaBucket: [{ runId }, { runId: other }],
      aiRetentionJob: [{ runId }, { runId: other }],
      aiKnowledgeEntry: [{ runId }, { runId: other }],
      aiClassPublication: [
        { runId, classScheduleId: manifest.classIds[0] },
        { runId: other, classScheduleId: "foreign-class" },
      ],
      aiProgramPublication: [
        { runId, programId: manifest.programIds[0] },
        { runId: other, programId: "foreign-program" },
      ],
    },
    lease: {
      runId,
      deploymentSha: sha,
      aiFixtureManifest: structuredClone(manifest),
    },
    metrics: [{ day: "2026-10-15", category: "HUMAN_HANDOFF", count: 7 }],
  };
  let failClass = false;
  let residualClass = false;
  let foreignTeacherLink = false;
  const deletes: string[] = [];
  const reads: string[] = [];
  const tx: Record<string, unknown> = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      if (strings.join("").includes("SELECT pg_advisory_xact_lock")) throw new Error("PRISMA_VOID_RESULT_UNSUPPORTED");
      return [];
    }),
    classTeacher:{count:vi.fn(async()=>foreignTeacherLink?1:0)},
    previewE2eRunLease: {
      findUnique: vi.fn(async () => state.lease),
      update: vi.fn(async () => {
        if (!state.lease) throw new Error("MISSING");
        state.lease.aiFixtureManifest = null;
        return state.lease;
      }),
    },
  };
  for (const table of [...aiTables, "program", "classSchedule"] as Table[]) {
    tx[table] = {
      findMany: vi.fn(async ({ where }: { where: Row }) => {
        reads.push(table);
        return state.tables[table].filter((row) => match(row, where));
      }),
      count: vi.fn(
        async ({ where }: { where: Row }) =>
          state.tables[table].filter((row) => match(row, where)).length,
      ),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        deletes.push(table);
        if (table === "classSchedule" && failClass)
          throw new Error("FOREIGN_REFERENCE_SECRET");
        if (table === "classSchedule" && residualClass) return { count: 0 };
        const before = state.tables[table].length;
        state.tables[table] = state.tables[table].filter(
          (row) => !match(row, where),
        );
        return { count: before - state.tables[table].length };
      }),
    };
  }
  Object.defineProperty(tx, "aiDailyMetric", {
    get() {
      throw new Error("ANONYMOUS_METRIC_ACCESS_FORBIDDEN");
    },
  });
  const client = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const before = structuredClone(state);
      try {
        return await fn(tx);
      } catch (error) {
        state = before;
        throw error;
      }
    }),
  } as unknown as Pick<PrismaClient, "$transaction">;
  return {
    client,
    get state() {
      return state;
    },
    deletes,
    reads,
    failClass() {
      failClass = true;
    },
    addForeignTeacherLink() {foreignTeacherLink=true;},
    leaveClass() {
      residualClass = true;
    },
  };
}
describe("Phase21 exact-owned cleanup", () => {
  it("refuses foreign ClassTeacher cascade dependencies before any deletion and retains ownership",async()=>{
    const f=fixture();f.addForeignTeacherLink();const before=structuredClone(f.state);
    await expect(cleanupPhase21PreviewRun(f.client,{runId,deploymentSha:sha,expectedManifest:manifest})).rejects.toThrow("AI_PREVIEW_CLEANUP_DENIED");
    expect(f.deletes).toHaveLength(0);expect(f.state).toEqual(before);expect(f.state.lease?.aiFixtureManifest).toEqual(manifest);
  });
  it("removes only exact run-owned synthetic rows and keeps anonymous metrics/foreign data", async () => {
    const f = fixture();
    const metrics = structuredClone(f.state.metrics);
    expect(
      await cleanupPhase21PreviewRun(f.client, {
        runId,
        deploymentSha: sha,
        expectedManifest: manifest,
      }),
    ).toEqual({
      residualAiRows: 0,
      residualPrograms: 0,
      residualClasses: 0,
      manifestCleared: true,
    });
    expect(f.state.tables.program).toEqual([
      { id: "foreign-program", name: "EXISTING" },
    ]);
    expect(f.state.tables.classSchedule).toHaveLength(1);
    for (const table of aiTables)
      expect(f.state.tables[table].every((row) => row.runId === other)).toBe(
        true,
      );
    expect(f.state.metrics).toEqual(metrics);
    expect(f.state.lease?.aiFixtureManifest).toBeNull();
    expect(
      (await cleanupPhase21PreviewRun(f.client, { runId, deploymentSha: sha }))
        .manifestCleared,
    ).toBe(false);
  });
  it("default run without AI manifest needs no AI keys and does not query/delete program fixtures", async () => {
    const f = fixture();
    f.state.lease!.aiFixtureManifest = null;
    for (const table of aiTables)
      f.state.tables[table] = f.state.tables[table].filter(
        (row) => row.runId !== runId,
      );
    f.state.tables.program = f.state.tables.program.filter(
      (row) => !manifest.programIds.includes(String(row.id)),
    );
    f.state.tables.classSchedule = f.state.tables.classSchedule.filter(
      (row) => !manifest.classIds.includes(String(row.id)),
    );
    const before = structuredClone(f.state);
    expect(
      (await cleanupPhase21PreviewRun(f.client, { runId, deploymentSha: sha }))
        .residualAiRows,
    ).toBe(0);
    expect(f.deletes).toHaveLength(0);
    expect(f.reads).not.toContain("program");
    expect(f.state).toEqual(before);
  });
  it.each(["missing", "malformed", "foreign", "duplicate"])(
    "denies %s manifest before mutation and keeps lease",
    async (scenario) => {
      const f = fixture();
      if (scenario === "missing") f.state.lease!.aiFixtureManifest = null;
      else if (scenario === "malformed")
        f.state.lease!.aiFixtureManifest = { synthetic: true };
      else if (scenario === "foreign")
        f.state.lease!.aiFixtureManifest = {
          ...manifest,
          programIds: [manifest.programIds[0].replace(runId, other)],
        };
      else
        f.state.lease!.aiFixtureManifest = {
          ...manifest,
          classIds: [...manifest.classIds, ...manifest.classIds],
        };
      const before = structuredClone(f.state);
      await expect(
        cleanupPhase21PreviewRun(f.client, { runId, deploymentSha: sha }),
      ).rejects.toThrow("AI_PREVIEW_CLEANUP_DENIED");
      expect(f.deletes).toHaveLength(0);
      expect(f.state).toEqual(before);
    },
  );
  it.each([
    "changed-facts",
    "foreign-publication",
    "foreign-origin",
    "wrong-sha",
    "missing-lease",
  ])("refuses %s and never erases existing rows", async (scenario) => {
    const f = fixture();
    if (scenario === "changed-facts")
      f.state.tables.program[0].name = "[SYNTHETIC] UNPROVEN";
    if (scenario === "foreign-publication")
      f.state.tables.aiClassPublication[0].classScheduleId = "foreign-class";
    if (scenario === "foreign-origin")
      f.state.tables.aiConsultation[0].origin = "LIVE";
    if (scenario === "missing-lease") f.state.lease = null;
    const before = structuredClone(f.state);
    await expect(
      cleanupPhase21PreviewRun(f.client, {
        runId,
        deploymentSha: scenario === "wrong-sha" ? "b".repeat(40) : sha,
      }),
    ).rejects.toThrow("AI_PREVIEW_CLEANUP_DENIED");
    expect(f.deletes).toHaveLength(0);
    expect(f.state).toEqual(before);
  });
  it.each(["delete-error", "residual"])(
    "rolls all deletions back on %s and retains ownership",
    async (scenario) => {
      const f = fixture();
      if (scenario === "delete-error") f.failClass();
      else f.leaveClass();
      const before = structuredClone(f.state);
      await expect(
        cleanupPhase21PreviewRun(f.client, { runId, deploymentSha: sha }),
      ).rejects.toThrow(/^AI_PREVIEW_CLEANUP_DENIED$/);
      expect(f.state).toEqual(before);
      expect(f.state.lease?.aiFixtureManifest).toEqual(manifest);
    },
  );
  it("rejects expected-manifest mismatch and invalid run before destructive work", async () => {
    const f = fixture();
    await expect(
      cleanupPhase21PreviewRun(f.client, {
        runId,
        deploymentSha: sha,
        expectedManifest: {
          ...manifest,
          subjectIds: ["synthetic-" + runId.slice(8) + "-000000000002"],
        },
      }),
    ).rejects.toThrow();
    expect(f.deletes).toHaveLength(0);
    expect(() => assertPhase21OwnedManifest(manifest, "../bad")).toThrow();
  });
});

it("missing manifest cannot report success/release ownership while run-prefixed fixtures remain", async () => {
  const f = fixture();
  f.state.lease!.aiFixtureManifest = null;
  for (const table of aiTables)
    f.state.tables[table] = f.state.tables[table].filter(
      (row) => row.runId !== runId,
    );
  const before = structuredClone(f.state);
  await expect(
    cleanupPhase21PreviewRun(f.client, { runId, deploymentSha: sha }),
  ).rejects.toThrow("AI_PREVIEW_CLEANUP_DENIED");
  expect(f.deletes).toHaveLength(0);
  expect(f.state).toEqual(before);
});
