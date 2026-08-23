"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/auth/authorization";
import { cancelClassInputSchema, classInputSchema, type ClassInput } from "@/lib/validation/class";
import { getClassDisplayStatus } from "@/lib/classes/status";

/**
 * 트랜잭션 내부에서 "확인 후 쓰기" 사이의 레이스 컨디션을 막기 위해 던지는 내부 전용 에러들이다.
 * $transaction 콜백 안에서 throw 되면 전체 트랜잭션이 롤백되고, 바깥 catch 블록이 instanceof 로
 * 구분해 기존과 동일한 사용자용 formError 메시지로 변환한다.
 * ARCHITECTURE.md §7.1 "상태 확인 후 쓰기(check-then-write) 패턴" 참고.
 */
class ProgramNotUsableError extends Error {}
class TeachersNotUsableError extends Error {}
class ClassNotUpdatableError extends Error {}
class ClassNotCancellableError extends Error {}

/** prisma 클라이언트와 $transaction 콜백의 tx 클라이언트를 모두 받을 수 있는 최소 타입이다. */
type PrismaLike = typeof prisma | Prisma.TransactionClient;

export type ClassFormFieldKey =
  | "programId"
  | "date"
  | "startTime"
  | "endTime"
  | "location"
  | "capacity"
  | "teacherIds"
  | "memo";

export type ClassFormValues = {
  programId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  capacity?: string;
  teacherIds?: string[];
  memo?: string;
};

export type ClassFormState = {
  errors?: Partial<Record<ClassFormFieldKey, string[]>>;
  formError?: string;
  values?: ClassFormValues;
};

function parseClassForm(formData: FormData) {
  return classInputSchema.safeParse({
    programId: formData.get("programId"),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    location: formData.get("location"),
    capacity: formData.get("capacity") || undefined,
    teacherIds: formData.getAll("teacherIds").filter((value): value is string => typeof value === "string"),
    memo: formData.get("memo") || undefined,
  });
}

/**
 * 검증 실패 시 사용자가 실제로 타이핑/선택한 원본 값을 그대로 돌려주기 위해 사용한다.
 * React 19 의 Server Action 폼은 액션 완료(성공/실패 무관) 시 uncontrolled 필드를 defaultValue 로
 * 리셋하므로, 검증 실패 응답에 원본 값을 담아 폼이 defaultValue 대신 이 값을 우선 사용하게 한다.
 */
function readClassFormValues(formData: FormData): ClassFormValues {
  const toStringOrUndefined = (value: FormDataEntryValue | null) =>
    typeof value === "string" ? value : undefined;

  return {
    programId: toStringOrUndefined(formData.get("programId")),
    date: toStringOrUndefined(formData.get("date")),
    startTime: toStringOrUndefined(formData.get("startTime")),
    endTime: toStringOrUndefined(formData.get("endTime")),
    location: toStringOrUndefined(formData.get("location")),
    capacity: toStringOrUndefined(formData.get("capacity")),
    teacherIds: formData.getAll("teacherIds").filter((value): value is string => typeof value === "string"),
    memo: toStringOrUndefined(formData.get("memo")),
  };
}

function toFieldErrors(error: import("zod").ZodError<unknown>): Partial<Record<ClassFormFieldKey, string[]>> {
  // classInputSchema 는 transform/refine 을 거치므로 flatten() 의 키가 폼 필드명과 정확히
  // 일치한다는 보장이 없다 — 알려진 폼 필드 키만 골라낸다.
  const flattened = error.flatten().fieldErrors as Record<string, string[] | undefined>;
  const known: ClassFormFieldKey[] = [
    "programId",
    "date",
    "startTime",
    "endTime",
    "location",
    "capacity",
    "teacherIds",
    "memo",
  ];
  const result: Partial<Record<ClassFormFieldKey, string[]>> = {};
  for (const key of known) {
    if (flattened[key]) {
      result[key] = flattened[key];
    }
  }
  return result;
}

/**
 * 프로그램이 실제로 존재하고 ACTIVE 상태인지 서버에서 재확인한다.
 * 클라이언트가 후보 목록(listProgramCandidates)을 우회해 임의의 값으로 직접 POST 해도 막는다.
 */
async function isProgramUsable(client: PrismaLike, programId: string): Promise<boolean> {
  const program = await client.program.findUnique({
    where: { id: programId },
    select: { status: true },
  });
  return program?.status === "ACTIVE";
}

/**
 * 선생님들이 모두 실제로 존재하고 isActive 인지 서버에서 재확인한다.
 * 클라이언트가 후보 목록(listTeacherCandidates)을 우회해 임의의 값으로 직접 POST 해도 막는다.
 */
async function areTeachersUsable(client: PrismaLike, teacherIds: string[]): Promise<boolean> {
  if (teacherIds.length === 0) {
    return false;
  }
  const activeCount = await client.teacher.count({
    where: { id: { in: teacherIds }, isActive: true },
  });
  return activeCount === teacherIds.length;
}

export async function createClass(_prevState: ClassFormState, formData: FormData): Promise<ClassFormState> {
  await requireAdmin();

  const result = parseClassForm(formData);
  if (!result.success) {
    return { errors: toFieldErrors(result.error), values: readClassFormValues(formData) };
  }

  const data: ClassInput = result.data;

  // isProgramUsable/areTeachersUsable 재확인은 $transaction 내부에서(같은 tx 클라이언트로) 실행한다.
  // 확인과 실제 classSchedule.create 사이의 시간 간격을 최소화해 TOCTOU 레이스 창을 좁히기 위함이다
  // (ARCHITECTURE.md §7.1). 관리자 전용 도구이므로 완벽한 직렬화 격리까지는 필요 없다.
  let createdId: string;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const [programUsable, teachersUsable] = await Promise.all([
        isProgramUsable(tx, data.programId),
        areTeachersUsable(tx, data.teacherIds),
      ]);

      if (!programUsable) {
        throw new ProgramNotUsableError();
      }
      if (!teachersUsable) {
        throw new TeachersNotUsableError();
      }

      const classSchedule = await tx.classSchedule.create({
        data: {
          programId: data.programId,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          location: data.location,
          capacity: data.capacity,
          status: "SCHEDULED",
          memo: data.memo || null,
        },
      });

      await tx.classTeacher.createMany({
        data: data.teacherIds.map((teacherId) => ({
          classScheduleId: classSchedule.id,
          teacherId,
        })),
      });

      return classSchedule;
    });
    createdId = created.id;
  } catch (error) {
    if (error instanceof ProgramNotUsableError) {
      return {
        formError: "선택한 프로그램을 사용할 수 없습니다. 다시 선택해주세요.",
        values: readClassFormValues(formData),
      };
    }
    if (error instanceof TeachersNotUsableError) {
      return {
        formError: "선택한 선생님 중 배정할 수 없는 선생님이 있습니다. 다시 선택해주세요.",
        values: readClassFormValues(formData),
      };
    }
    console.error("[classes] failed to create class:", error instanceof Error ? error.message : "unknown error");
    return { formError: "클래스 등록에 실패했습니다. 다시 시도해주세요.", values: readClassFormValues(formData) };
  }

  revalidatePath("/classes");
  redirect(`/classes/${createdId}`);
}

export async function updateClass(
  id: string,
  _prevState: ClassFormState,
  formData: FormData,
): Promise<ClassFormState> {
  await requireAdmin();

  const current = await prisma.classSchedule.findUnique({
    where: { id },
    select: { status: true, endsAt: true },
  });

  if (!current) {
    return { formError: "클래스를 찾을 수 없습니다." };
  }

  // ADR-020: 취소/완료된 클래스는 기본정보(메모 포함)를 수정할 수 없다. 필드별로 나눠 잠그지 않는다.
  // DB status 는 계속 SCHEDULED 로 남지만, endsAt 이 지난 클래스는 화면상 "종료됨"으로 표시되므로
  // 표시상 종료된 클래스도 동일하게 수정을 막는다(getClassDisplayStatus, lib/classes/status.ts).
  if (getClassDisplayStatus(current) !== "SCHEDULED") {
    return {
      formError: "취소되었거나 종료된 클래스는 수정할 수 없습니다.",
      values: readClassFormValues(formData),
    };
  }

  const result = parseClassForm(formData);
  if (!result.success) {
    return { errors: toFieldErrors(result.error), values: readClassFormValues(formData) };
  }

  const data: ClassInput = result.data;

  // isProgramUsable/areTeachersUsable 재확인은 createClass 와 동일하게 $transaction 내부에서
  // (같은 tx 클라이언트로) 실행한다. 확인과 실제 쓰기 사이의 시간 간격을 최소화해 TOCTOU 레이스
  // 창을 좁히기 위함이다(ARCHITECTURE.md §7.1). 상태 조건부 updateMany 는 이미 가장 저렴하고
  // 확실한 확인이므로 트랜잭션의 첫 작업 자리를 유지하고, 프로그램/선생님 재확인은 그 다음
  // — ClassTeacher diff 보다 먼저 — 수행한다.
  try {
    await prisma.$transaction(async (tx) => {
      // ADR-020: 트랜잭션 시작 전(위의 사전 체크) ~ 여기 사이에 다른 요청이 먼저 이 클래스를
      // 취소했을 수 있다(TOCTOU). 그래서 최종 쓰기 자체를 status 조건부 updateMany 로 만들고,
      // ClassTeacher diff 보다 먼저 — 트랜잭션의 첫 작업으로 — 실행해 레이스를 막는다
      // (ARCHITECTURE.md §7.1). status 값 자체는 여기서 절대 건드리지 않는다 — 상태 전환은
      // cancelClass 전용이다.
      const updateResult = await tx.classSchedule.updateMany({
        where: { id, status: "SCHEDULED" },
        data: {
          programId: data.programId,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          location: data.location,
          capacity: data.capacity,
          memo: data.memo || null,
        },
      });

      if (updateResult.count === 0) {
        throw new ClassNotUpdatableError();
      }

      const [programUsable, teachersUsable] = await Promise.all([
        isProgramUsable(tx, data.programId),
        areTeachersUsable(tx, data.teacherIds),
      ]);

      if (!programUsable) {
        throw new ProgramNotUsableError();
      }
      if (!teachersUsable) {
        throw new TeachersNotUsableError();
      }

      const existingAssignments = await tx.classTeacher.findMany({
        where: { classScheduleId: id },
        select: { teacherId: true },
      });
      const existingTeacherIds = new Set(existingAssignments.map((assignment) => assignment.teacherId));
      const nextTeacherIds = new Set(data.teacherIds);

      const toRemove = [...existingTeacherIds].filter((teacherId) => !nextTeacherIds.has(teacherId));
      const toAdd = [...nextTeacherIds].filter((teacherId) => !existingTeacherIds.has(teacherId));

      if (toRemove.length > 0) {
        await tx.classTeacher.deleteMany({
          where: { classScheduleId: id, teacherId: { in: toRemove } },
        });
      }
      if (toAdd.length > 0) {
        await tx.classTeacher.createMany({
          data: toAdd.map((teacherId) => ({ classScheduleId: id, teacherId })),
        });
      }
    });
  } catch (error) {
    if (error instanceof ClassNotUpdatableError) {
      return {
        formError: "취소되었거나 완료된 클래스는 수정할 수 없습니다.",
        values: readClassFormValues(formData),
      };
    }
    if (error instanceof ProgramNotUsableError) {
      return {
        formError: "선택한 프로그램을 사용할 수 없습니다. 다시 선택해주세요.",
        values: readClassFormValues(formData),
      };
    }
    if (error instanceof TeachersNotUsableError) {
      return {
        formError: "선택한 선생님 중 배정할 수 없는 선생님이 있습니다. 다시 선택해주세요.",
        values: readClassFormValues(formData),
      };
    }
    console.error("[classes] failed to update class:", error instanceof Error ? error.message : "unknown error");
    return {
      formError: "클래스 정보 수정에 실패했습니다. 다시 시도해주세요.",
      values: readClassFormValues(formData),
    };
  }

  revalidatePath("/classes");
  revalidatePath(`/classes/${id}`);
  redirect(`/classes/${id}`);
}

export type ClassCancelFormFieldKey = "cancelReason" | "cancelDetail";

export type ClassCancelFormValues = {
  cancelReason?: string;
  cancelDetail?: string;
};

export type ClassCancelFormState = {
  errors?: Partial<Record<ClassCancelFormFieldKey, string[]>>;
  formError?: string;
  values?: ClassCancelFormValues;
};

/**
 * 취소 검증/처리 실패 시 사용자가 실제로 선택/입력한 원본 값을 그대로 돌려주기 위해 사용한다.
 * Zod 검증 실패든 서버 재확인(formError, 예: 이미 취소된 클래스 재취소 시도) 실패든 구분 없이
 * 동일하게 값을 보존한다 — §2 참고.
 */
function readCancelClassFormValues(formData: FormData): ClassCancelFormValues {
  const toStringOrUndefined = (value: FormDataEntryValue | null) =>
    typeof value === "string" ? value : undefined;

  return {
    cancelReason: toStringOrUndefined(formData.get("cancelReason")),
    cancelDetail: toStringOrUndefined(formData.get("cancelDetail")),
  };
}

export async function cancelClass(
  id: string,
  _prevState: ClassCancelFormState,
  formData: FormData,
): Promise<ClassCancelFormState> {
  const session = await requireAdmin();

  const current = await prisma.classSchedule.findUnique({
    where: { id },
    select: { status: true, endsAt: true },
  });

  if (!current) {
    return { formError: "클래스를 찾을 수 없습니다.", values: readCancelClassFormValues(formData) };
  }

  // DB status 는 계속 SCHEDULED 로 남지만, endsAt 이 지난 클래스는 화면상 "완료"로 표시되므로
  // 표시상 종료된 클래스의 취소도 동일하게 막는다(getClassDisplayStatus, lib/classes/status.ts).
  if (getClassDisplayStatus(current) !== "SCHEDULED") {
    return {
      formError: "이미 취소되었거나 종료된 클래스는 취소할 수 없습니다.",
      values: readCancelClassFormValues(formData),
    };
  }

  const result = cancelClassInputSchema.safeParse({
    cancelReason: formData.get("cancelReason"),
    cancelDetail: formData.get("cancelDetail") || undefined,
  });

  if (!result.success) {
    return {
      errors: result.error.flatten().fieldErrors,
      values: readCancelClassFormValues(formData),
    };
  }

  try {
    // 위의 findUnique 사전 체크는 "클래스가 아예 존재하지 않는 경우"를 구분해 404 성격의 메시지를
    // 주기 위한 것일 뿐, 상태 레이스는 막지 못한다(TOCTOU) — 사전 체크 이후 다른 취소 요청이 먼저
    // 도착했을 수 있다. 그래서 실제 쓰기는 status 조건부 updateMany 로 하고 count 로 최종 판정한다
    // (ARCHITECTURE.md §7.1).
    const updateResult = await prisma.classSchedule.updateMany({
      where: { id, status: "SCHEDULED" },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: result.data.cancelReason,
        cancelDetail: result.data.cancelDetail || null,
        cancelledById: session.user.id,
      },
    });

    if (updateResult.count === 0) {
      throw new ClassNotCancellableError();
    }
  } catch (error) {
    if (error instanceof ClassNotCancellableError) {
      return {
        formError: "이미 취소되었거나 완료된 클래스는 다시 취소할 수 없습니다.",
        values: readCancelClassFormValues(formData),
      };
    }
    console.error("[classes] failed to cancel class:", error instanceof Error ? error.message : "unknown error");
    return {
      formError: "클래스 취소에 실패했습니다. 다시 시도해주세요.",
      values: readCancelClassFormValues(formData),
    };
  }

  revalidatePath("/classes");
  revalidatePath(`/classes/${id}`);
  redirect(`/classes/${id}`);
}
