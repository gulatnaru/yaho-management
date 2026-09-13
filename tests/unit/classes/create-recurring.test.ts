import { describe, expect, it, vi } from "vitest";
import { recurringClassInputSchema, type RecurringClassInput } from "@/lib/validation/class";
import {
  createRecurringClassesCore,
  RecurringClassDuplicateError,
} from "@/server/classes/create-recurring";

function recurringInput(overrides: Partial<RecurringClassInput> = {}): RecurringClassInput {
  const result = recurringClassInputSchema.parse({
    programId: "program-1",
    repeatStartDate: "2026-10-01",
    repeatEndDate: "2026-10-10",
    weekdays: ["6"],
    startTime: "09:00",
    endTime: "11:00",
    location: "반복 운동장",
    capacity: 8,
    teacherIds: ["teacher-1", "teacher-2"],
    memo: "반복 메모",
    insured: true,
    insurer: "테스트 보험",
    insurancePolicyNo: "POLICY-TEST",
    safetyMemo: "합성 안전 메모",
  });
  return { ...result, ...overrides };
}

function createClient(options?: {
  programRows?: Array<{ id: string; status: string }>;
  activeTeacherCount?: number;
  duplicates?: Array<{ startsAt: Date }>;
  teacherWriteError?: Error;
}) {
  const calls: string[] = [];
  const queryRaw = vi.fn(async (query: unknown) => {
    void query;
    calls.push("program-lock");
    return options?.programRows ?? [{ id: "program-1", status: "ACTIVE" }];
  });
  const teacherCount = vi.fn(async () => {
    calls.push("teacher-check");
    return options?.activeTeacherCount ?? 2;
  });
  const findMany = vi.fn(async (query: unknown) => {
    void query;
    calls.push("duplicate-query");
    return options?.duplicates ?? [];
  });
  const createManyAndReturn = vi.fn(async () => {
    calls.push("class-write");
    return [{ id: "class-1" }, { id: "class-2" }];
  });
  const classTeacherCreateMany = vi.fn(async () => {
    calls.push("teacher-write");
    if (options?.teacherWriteError) throw options.teacherWriteError;
    return { count: 4 };
  });

  const tx = {
    $queryRaw: queryRaw,
    teacher: { count: teacherCount },
    classSchedule: { findMany, createManyAndReturn },
    classTeacher: { createMany: classTeacherCreateMany },
  };
  const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));

  return {
    client: { $transaction: transaction } as never,
    calls,
    queryRaw,
    findMany,
    createManyAndReturn,
    classTeacherCreateMany,
  };
}

describe("createRecurringClassesCore", () => {
  it("locks the Program before ACTIVE and duplicate checks, then writes one atomic batch", async () => {
    const harness = createClient();

    const result = await createRecurringClassesCore(recurringInput(), harness.client);

    expect(result.classIds).toEqual(["class-1", "class-2"]);
    expect(harness.calls).toEqual([
      "program-lock",
      "teacher-check",
      "duplicate-query",
      "class-write",
      "teacher-write",
    ]);
    expect(typeof harness.queryRaw.mock.calls[0]?.[0]).not.toBe("string");
  });

  it("checks duplicates by exact program, timestamps, and trimmed location without filtering status", async () => {
    const harness = createClient();

    await createRecurringClassesCore(recurringInput(), harness.client);

    expect(harness.findMany).toHaveBeenCalledWith({
      where: {
        programId: "program-1",
        location: "반복 운동장",
        OR: [
          {
            startsAt: new Date("2026-10-03T00:00:00.000Z"),
            endsAt: new Date("2026-10-03T02:00:00.000Z"),
          },
          {
            startsAt: new Date("2026-10-10T00:00:00.000Z"),
            endsAt: new Date("2026-10-10T02:00:00.000Z"),
          },
        ],
      },
      select: { startsAt: true },
    });
    expect(harness.findMany.mock.calls[0]?.[0]).not.toHaveProperty("where.status");
  });

  it("throws before every write when one occurrence is a duplicate", async () => {
    const harness = createClient({
      duplicates: [{ startsAt: new Date("2026-10-03T00:00:00.000Z") }],
    });

    await expect(createRecurringClassesCore(recurringInput(), harness.client)).rejects.toEqual(
      expect.objectContaining<Partial<RecurringClassDuplicateError>>({ dates: ["2026-10-03"] }),
    );
    expect(harness.createManyAndReturn).not.toHaveBeenCalled();
    expect(harness.classTeacherCreateMany).not.toHaveBeenCalled();
  });

  it("propagates a ClassTeacher write failure so the enclosing Prisma transaction rolls back", async () => {
    const harness = createClient({ teacherWriteError: new Error("CLASS_TEACHER_WRITE_FAILED") });

    await expect(createRecurringClassesCore(recurringInput(), harness.client)).rejects.toThrow(
      "CLASS_TEACHER_WRITE_FAILED",
    );
    expect(harness.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(harness.classTeacherCreateMany).toHaveBeenCalledTimes(1);
  });
});
