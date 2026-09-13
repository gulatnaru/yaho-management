import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { combineKstToUtc, formatKstDate } from "@/lib/classes/datetime";
import type { RecurringClassInput } from "@/lib/validation/class";

export class RecurringProgramNotUsableError extends Error {}
export class RecurringTeachersNotUsableError extends Error {}

export class RecurringClassDuplicateError extends Error {
  constructor(readonly dates: string[]) {
    super("duplicate recurring classes");
  }
}

type RecurringClassTransactionClient = Pick<typeof prisma, "$transaction">;

export type RecurringClassCreateResult = {
  classIds: string[];
};

/**
 * 반복 생성 요청 하나를 원자적으로 처리한다.
 * Program 행 잠금은 같은 Program을 대상으로 하는 반복 요청끼리만 직렬화한다. 기존 단건 생성의
 * 중복 허용 정책이나 모든 생성 경로에 대한 전역 유일성을 제공하지 않는다.
 */
export async function createRecurringClassesCore(
  input: RecurringClassInput,
  client: RecurringClassTransactionClient = prisma,
): Promise<RecurringClassCreateResult> {
  return client.$transaction(async (tx) => {
    const programRows = await tx.$queryRaw<Array<{ id: string; status: string }>>(
      Prisma.sql`SELECT "id", "status" FROM "Program" WHERE "id" = ${input.programId} FOR UPDATE`,
    );
    if (programRows[0]?.status !== "ACTIVE") {
      throw new RecurringProgramNotUsableError();
    }

    const activeTeacherCount = await tx.teacher.count({
      where: { id: { in: input.teacherIds }, isActive: true },
    });
    if (activeTeacherCount !== input.teacherIds.length) {
      throw new RecurringTeachersNotUsableError();
    }

    const occurrences = input.targetDates.map((date) => ({
      date,
      startsAt: combineKstToUtc(date, input.startTime),
      endsAt: combineKstToUtc(date, input.endTime),
    }));
    const duplicates = await tx.classSchedule.findMany({
      where: {
        programId: input.programId,
        location: input.location,
        OR: occurrences.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
      },
      select: { startsAt: true },
    });
    if (duplicates.length > 0) {
      throw new RecurringClassDuplicateError(
        [...new Set(duplicates.map(({ startsAt }) => formatKstDate(startsAt)))].sort(),
      );
    }

    const createdClasses = await tx.classSchedule.createManyAndReturn({
      data: occurrences.map(({ startsAt, endsAt }) => ({
        programId: input.programId,
        startsAt,
        endsAt,
        location: input.location,
        capacity: input.capacity,
        status: "SCHEDULED" as const,
        memo: input.memo || null,
        insured: input.insured,
        insurer: input.insurer || null,
        insurancePolicyNo: input.insurancePolicyNo || null,
        safetyMemo: input.safetyMemo || null,
      })),
      select: { id: true },
    });

    await tx.classTeacher.createMany({
      data: createdClasses.flatMap(({ id: classScheduleId }) =>
        input.teacherIds.map((teacherId) => ({ classScheduleId, teacherId })),
      ),
    });

    return { classIds: createdClasses.map(({ id }) => id) };
  });
}
