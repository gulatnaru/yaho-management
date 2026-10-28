import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createTools,
  SYNTHETIC_FACTS,
  toolCallSchema,
} from "@/server/ai-consultations/tools";
import {
  runAgent,
  mockProvider,
  render,
} from "@/server/ai-consultations/agent";
import { HUMAN_HANDOFF } from "@/lib/ai-consultations/contracts";
import { scope } from "./fixtures";
function fixture() {
  const tx = {
    program: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: scope.manifest.programIds[0],
          name: SYNTHETIC_FACTS.name,
          description: SYNTHETIC_FACTS.description,
          targetAgeMin: 5,
          targetAgeMax: 8,
          internalSecret: "PRIVATE",
        },
      ]),
    },
    classSchedule: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: scope.manifest.classIds[0],
          programId: scope.manifest.programIds[0],
          startsAt: new Date(Date.now() + 86400000),
          endsAt: new Date(Date.now() + 86500000),
          location: SYNTHETIC_FACTS.location,
          capacity: 8,
        },
      ]),
      findFirst: vi
        .fn()
        .mockResolvedValue({ capacity: 8, _count: { reservations: 7 } }),
    },
    aiKnowledgeEntry: { findUnique: vi.fn().mockResolvedValue(null) },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) =>
      strings.join("").includes("SELECT EXISTS") ? [{ held: true }] : [],
    ),
    previewE2eRunLease: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          deploymentSha: scope.deploymentSha,
          expiresAt: new Date(Date.now() + 86400000),
          aiFixtureManifest: scope.manifest,
        }),
    },
  };
  const client = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
  } as unknown as PrismaClient;
  return { client, tx, tools: createTools(client, scope) };
}
const signal = () => new AbortController().signal;
describe("AC21-02..06/12 safe tools and facts", () => {
  it("exposes opaque handles and approved synthetic fields only, never underlying IDs/seat numbers", async () => {
    const f = fixture();
    const programs = await f.tools.execute(
      { name: "list_public_programs", args: {} },
      signal(),
    );
    const classes = await f.tools.execute(
      { name: "list_public_classes", args: {} },
      signal(),
    );
    const text = JSON.stringify([programs, classes]);
    expect(text).toContain("program-1");
    expect(text).toContain("class-1");
    for (const privateField of [
      ...scope.manifest.classIds,
      ...scope.manifest.programIds,
      "capacity",
      "internalSecret",
      "_count",
    ])
      expect(text).not.toContain(privateField);
    const args = f.tx.classSchedule.findMany.mock.calls[0][0];
    expect(args.where.aiPublications.some).toEqual({
      runId: scope.runId,
      enabled: true,
    });
    expect(args.where.program.aiPublications.some.enabled).toBe(true);
    expect(args).not.toHaveProperty("applicationLink");
  });
  it.each([
    { capacity: 8, count: 7, status: "AVAILABLE" },
    { capacity: 8, count: 8, status: "UNAVAILABLE" },
    { capacity: 8, count: 9, status: "UNAVAILABLE" },
  ])("returns only availability status for $count", async (row) => {
    const f = fixture();
    f.tx.classSchedule.findFirst.mockResolvedValue({
      capacity: row.capacity,
      _count: { reservations: row.count },
    });
    const result = await f.tools.execute(
      { name: "get_class_availability", args: { classHandle: "class-1" } },
      signal(),
    );
    expect(result).toEqual({ kind: "AVAILABILITY", status: row.status });
    expect(JSON.stringify(result)).not.toMatch(
      /capacity|reservation|remaining|count|[0-9]/,
    );
  });
  it("unknown/unpublished targets and DB failure give UNKNOWN", async () => {
    const f = fixture();
    expect(
      await f.tools.execute(
        {
          name: "get_class_availability",
          args: { classHandle: "private-class-id" },
        },
        signal(),
      ),
    ).toEqual({ kind: "AVAILABILITY", status: "UNKNOWN" });
    expect(f.tx.classSchedule.findFirst).not.toHaveBeenCalled();
    f.tx.classSchedule.findFirst.mockResolvedValue(null);
    expect(
      await f.tools.execute(
        { name: "get_class_availability", args: { classHandle: "class-1" } },
        signal(),
      ),
    ).toEqual({ kind: "AVAILABILITY", status: "UNKNOWN" });
    f.tx.classSchedule.findFirst.mockRejectedValue(new Error("PRIVATE_DB"));
    expect(
      await f.tools.execute(
        { name: "get_class_availability", args: { classHandle: "class-1" } },
        signal(),
      ),
    ).toEqual({ kind: "AVAILABILITY", status: "UNKNOWN" });
  });
  it("does not trust a synthetic prefix on arbitrary stored text", async () => {
    const f = fixture();
    f.tx.program.findMany.mockResolvedValue([
      {
        id: scope.manifest.programIds[0],
        name: "[SYNTHETIC] actual customer",
        description: SYNTHETIC_FACTS.description,
        targetAgeMin: 5,
        targetAgeMax: 8,
      },
    ]);
    await expect(
      f.tools.execute({ name: "list_public_programs", args: {} }, signal()),
    ).rejects.toThrow();
  });
  it("missing official guidance renders fixed handoff", async () => {
    const f = fixture();
    const reply = await runAgent(
      { scenario: "RAIN" },
      f.tools,
      mockProvider,
      signal(),
    );
    expect(reply).toEqual({ category: "HUMAN_HANDOFF", text: HUMAN_HANDOFF });
    expect(f.tx.aiKnowledgeEntry.findUnique).toHaveBeenCalledTimes(2);
  });
  it.each(["OUT_OF_SCOPE", "INJECTION"] as const)(
    "no tool invocation for %s",
    async (scenario) => {
      const tools = { execute: vi.fn() };
      expect(
        await runAgent({ scenario }, tools, mockProvider, signal()),
      ).toEqual({ category: "HUMAN_HANDOFF", text: HUMAN_HANDOFF });
      expect(tools.execute).not.toHaveBeenCalled();
    },
  );
  it("denies unknown tools/additional SQL arguments and replaced provider authority", async () => {
    for (const value of [
      { name: "execute_sql", args: { sql: "SELECT *" } },
      { name: "list_public_programs", args: { sql: "SELECT *" } },
      { name: "get_class_availability", args: { classId: "internal" } },
    ])
      expect(toolCallSchema.safeParse(value).success).toBe(false);
    const f = fixture();
    await expect(
      runAgent(
        { scenario: "PROGRAMS" },
        f.tools,
        {
          plan: vi
            .fn()
            .mockResolvedValue({ name: "list_public_classes", args: {} }),
        },
        signal(),
      ),
    ).rejects.toThrow();
    expect(f.tx.classSchedule.findMany).not.toHaveBeenCalled();
  });
  it("re-reads publication immediately before rendering rather than exposing first result", async () => {
    const f = fixture();
    f.tx.program.findMany
      .mockResolvedValueOnce([
        {
          id: scope.manifest.programIds[0],
          name: SYNTHETIC_FACTS.name,
          description: SYNTHETIC_FACTS.description,
          targetAgeMin: 5,
          targetAgeMax: 8,
        },
      ])
      .mockResolvedValueOnce([]);
    expect(
      await runAgent({ scenario: "PROGRAMS" }, f.tools, mockProvider, signal()),
    ).toEqual({ category: "HUMAN_HANDOFF", text: HUMAN_HANDOFF });
  });
  it("uses bounded DB statement and transaction timeout with no provider transaction", async () => {
    const f = fixture();
    await f.tools.execute({ name: "list_public_programs", args: {} }, signal());
    expect(f.client.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 40,
      timeout: 250,
    });
    expect(f.tx.$executeRaw.mock.calls.flat().join(" ")).toContain("180ms");
  });
  it("format never promises reservation creation or reveals numeric availability", () => {
    expect(
      render({ kind: "AVAILABILITY", status: "AVAILABLE" }).text,
    ).toContain("예약 확정이 아닙니다");
    expect(
      render({ kind: "AVAILABILITY", status: "UNAVAILABLE" }).text,
    ).not.toMatch(/[0-9]/);
  });
});
