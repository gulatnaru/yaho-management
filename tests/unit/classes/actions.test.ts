import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminMock = vi.fn();
const classCreateMock = vi.fn();
const classUpdateManyMock = vi.fn();
const classFindUniqueMock = vi.fn();
const classScheduleUpdateManyMock = vi.fn();
const classTeacherCreateManyMock = vi.fn();
const classTeacherFindManyMock = vi.fn();
const classTeacherDeleteManyMock = vi.fn();
const programFindUniqueMock = vi.fn();
const teacherCountMock = vi.fn();
const transactionMock = vi.fn();

const txMock = {
  classSchedule: {
    create: (...args: unknown[]) => classCreateMock(...args),
    updateMany: (...args: unknown[]) => classUpdateManyMock(...args),
  },
  classTeacher: {
    createMany: (...args: unknown[]) => classTeacherCreateManyMock(...args),
    findMany: (...args: unknown[]) => classTeacherFindManyMock(...args),
    deleteMany: (...args: unknown[]) => classTeacherDeleteManyMock(...args),
  },
  program: {
    findUnique: (...args: unknown[]) => programFindUniqueMock(...args),
  },
  teacher: {
    count: (...args: unknown[]) => teacherCountMock(...args),
  },
};

vi.mock("@/lib/auth/authorization", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    classSchedule: {
      findUnique: (...args: unknown[]) => classFindUniqueMock(...args),
      updateMany: (...args: unknown[]) => classScheduleUpdateManyMock(...args),
    },
    program: {
      findUnique: (...args: unknown[]) => programFindUniqueMock(...args),
    },
    teacher: {
      count: (...args: unknown[]) => teacherCountMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

const { cancelClass, createClass, updateClass } = await import("@/app/(admin)/classes/actions");

function validFormData(overrides: Record<string, string | string[]> = {}) {
  const formData = new FormData();
  const base: Record<string, string | string[]> = {
    programId: "program-1",
    date: "2026-09-05",
    startTime: "09:00",
    endTime: "11:00",
    location: "실외 운동장",
    capacity: "8",
    teacherIds: ["teacher-1"],
    ...overrides,
  };

  for (const [key, value] of Object.entries(base)) {
    if (Array.isArray(value)) {
      for (const v of value) formData.append(key, v);
    } else {
      formData.set(key, value);
    }
  }
  return formData;
}

describe("classes server actions require admin", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    classCreateMock.mockReset();
    classUpdateManyMock.mockReset();
    classFindUniqueMock.mockReset();
    transactionMock.mockReset();
  });

  it("createClass rejects and never touches prisma when requireAdmin denies access", async () => {
    requireAdminMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(createClass({}, validFormData())).rejects.toThrow("UNAUTHORIZED");
    expect(transactionMock).not.toHaveBeenCalled();
    expect(classFindUniqueMock).not.toHaveBeenCalled();
  });

  it("updateClass rejects and never touches prisma when requireAdmin denies access", async () => {
    requireAdminMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(updateClass("class-1", {}, validFormData())).rejects.toThrow("UNAUTHORIZED");
    expect(classFindUniqueMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("createClass validation", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ user: { role: "ADMIN" } });
    programFindUniqueMock.mockReset();
    teacherCountMock.mockReset();
    transactionMock.mockReset();
    // programId/teacherIds 재확인은 이제 $transaction 내부(tx 클라이언트)에서 실행되므로,
    // 콜백에 txMock 을 전달하는 기본 구현을 준다 — 실제 prisma.$transaction 이 콜백을
    // await 하고 그 결과(또는 throw)를 그대로 반환/전파하는 것과 동일하게 동작한다.
    transactionMock.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));
    classCreateMock.mockReset();
    classTeacherCreateManyMock.mockReset();
  });

  it("rejects capacity of 9 or more even if a client bypasses the browser's max attribute", async () => {
    const result = await createClass({}, validFormData({ capacity: "9" }));

    expect(result.errors?.capacity).toBeDefined();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects when the posted programId is not ACTIVE, even if it bypasses the candidate list, and rolls back without creating anything", async () => {
    programFindUniqueMock.mockResolvedValue({ status: "INACTIVE" });
    teacherCountMock.mockResolvedValue(1);

    const result = await createClass({}, validFormData());

    expect(result.formError).toBeDefined();
    // 재확인은 트랜잭션 내부에서 일어나므로 $transaction 자체는 호출되지만, 확인 실패 시
    // 트랜잭션 내부에서 즉시 throw 해 롤백되어 실제 생성(create/createMany)까지는 가지 않는다.
    expect(classCreateMock).not.toHaveBeenCalled();
    expect(classTeacherCreateManyMock).not.toHaveBeenCalled();
  });

  it("rejects when a posted teacherId is not active, even if it bypasses the candidate list, and rolls back without creating anything", async () => {
    programFindUniqueMock.mockResolvedValue({ status: "ACTIVE" });
    teacherCountMock.mockResolvedValue(0); // requested 1 teacherId, 0 are active

    const result = await createClass({}, validFormData());

    expect(result.formError).toBeDefined();
    expect(classCreateMock).not.toHaveBeenCalled();
    expect(classTeacherCreateManyMock).not.toHaveBeenCalled();
  });

  it("creates the class and assigns teachers within the same transaction when the program and teachers are usable", async () => {
    programFindUniqueMock.mockResolvedValue({ status: "ACTIVE" });
    teacherCountMock.mockResolvedValue(1);
    classCreateMock.mockResolvedValue({ id: "class-new" });
    classTeacherCreateManyMock.mockResolvedValue({ count: 1 });

    await expect(createClass({}, validFormData())).rejects.toThrow("REDIRECT");

    expect(classCreateMock).toHaveBeenCalledTimes(1);
    expect(classTeacherCreateManyMock).toHaveBeenCalledTimes(1);
  });

  // 버그 리그레션: React 19 Server Action 폼은 액션 완료 시 uncontrolled 필드를 defaultValue로
  // 리셋한다. 검증 실패 시 사용자가 입력/선택했던 원본 값(teacherIds 포함)을 `values`로 돌려주지
  // 않으면 재렌더링 시 date/startTime/endTime 등 모든 필드가 비어버려, 재제출 시 엉뚱한 검증
  // 오류(예: "종료 시간은 시작 시간보다 나중이어야 합니다")로 이어질 수 있다.
  it("returns the submitted raw values (including teacherIds) in `values` when validation fails", async () => {
    const formData = validFormData({
      startTime: "09:00",
      endTime: "09:00", // invalid: end must be after start -> triggers validation failure
      teacherIds: ["teacher-1", "teacher-2"],
    });

    const result = await createClass({}, formData);

    expect(result.errors?.endTime).toBeDefined();
    expect(result.values).toEqual({
      programId: "program-1",
      date: "2026-09-05",
      startTime: "09:00",
      endTime: "09:00",
      location: "실외 운동장",
      capacity: "8",
      teacherIds: ["teacher-1", "teacher-2"],
      memo: undefined,
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("updateClass locks CANCELLED/COMPLETED classes", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ user: { role: "ADMIN" } });
    classFindUniqueMock.mockReset();
    transactionMock.mockReset();
  });

  it("rejects any update (including memo-only changes) when the class is CANCELLED", async () => {
    classFindUniqueMock.mockResolvedValue({ status: "CANCELLED" });

    const result = await updateClass("class-1", {}, validFormData({ memo: "메모만 변경" }));

    expect(result.formError).toBe("취소되었거나 완료된 클래스는 수정할 수 없습니다.");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects updates when the class is COMPLETED", async () => {
    classFindUniqueMock.mockResolvedValue({ status: "COMPLETED" });

    const result = await updateClass("class-1", {}, validFormData());

    expect(result.formError).toBe("취소되었거나 완료된 클래스는 수정할 수 없습니다.");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("updateClass also returns the submitted raw values in `values` when validation fails", async () => {
    classFindUniqueMock.mockResolvedValue({ status: "SCHEDULED" });

    const result = await updateClass(
      "class-1",
      {},
      validFormData({ startTime: "11:00", endTime: "09:00", teacherIds: ["teacher-1"] }),
    );

    expect(result.errors?.endTime).toBeDefined();
    expect(result.values).toMatchObject({ startTime: "11:00", endTime: "09:00", teacherIds: ["teacher-1"] });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("updateClass never reads status from formData", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ user: { role: "ADMIN" } });
    classFindUniqueMock.mockReset();
    classFindUniqueMock.mockResolvedValue({ status: "SCHEDULED" });
    programFindUniqueMock.mockReset();
    programFindUniqueMock.mockResolvedValue({ status: "ACTIVE" });
    teacherCountMock.mockReset();
    teacherCountMock.mockResolvedValue(1);
    transactionMock.mockReset();
    transactionMock.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));
    classTeacherFindManyMock.mockReset();
    classTeacherFindManyMock.mockResolvedValue([{ teacherId: "teacher-1" }]);
    classTeacherCreateManyMock.mockReset();
    classTeacherDeleteManyMock.mockReset();
    classUpdateManyMock.mockReset();
    classUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it("ignores a status field even if present in the submitted form data", async () => {
    const formData = validFormData();
    formData.set("status", "CANCELLED");

    await expect(updateClass("class-1", {}, formData)).rejects.toThrow("REDIRECT");

    expect(classUpdateManyMock).toHaveBeenCalledTimes(1);
    const [[callArg]] = classUpdateManyMock.mock.calls;
    expect(callArg.data).not.toHaveProperty("status");
  });

  it("conditions the final write on status: SCHEDULED", async () => {
    const formData = validFormData();

    await expect(updateClass("class-1", {}, formData)).rejects.toThrow("REDIRECT");

    const [[callArg]] = classUpdateManyMock.mock.calls;
    expect(callArg.where).toEqual({ id: "class-1", status: "SCHEDULED" });
  });
});

describe("updateClass re-validates program/teachers inside the transaction (rollback)", () => {
  // 2차 코드 리뷰 Minor: updateClass 도 createClass 와 동일하게 isProgramUsable/areTeachersUsable
  // 재확인을 $transaction 내부(tx 클라이언트)에서 실행해야 한다 — 확인과 실제 쓰기 사이의 TOCTOU
  // 레이스 창을 좁히기 위함이다(ARCHITECTURE.md §7.1). 재확인 실패 시 상태 조건부 updateMany 는
  // 이미 실행됐더라도(트랜잭션의 첫 작업이라서) ClassTeacher diff 까지는 절대 도달하지 않아야
  // 한다 — 도달했다면 트랜잭션 콜백 안에서 재확인이 diff 보다 먼저 실행되지 않았다는 뜻이다.
  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ user: { role: "ADMIN" } });
    classFindUniqueMock.mockReset();
    classFindUniqueMock.mockResolvedValue({ status: "SCHEDULED" });
    programFindUniqueMock.mockReset();
    teacherCountMock.mockReset();
    transactionMock.mockReset();
    transactionMock.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));
    classUpdateManyMock.mockReset();
    classUpdateManyMock.mockResolvedValue({ count: 1 });
    classTeacherFindManyMock.mockReset();
    classTeacherCreateManyMock.mockReset();
    classTeacherDeleteManyMock.mockReset();
  });

  it("rejects when the posted programId is not ACTIVE and rolls back without touching ClassTeacher", async () => {
    programFindUniqueMock.mockResolvedValue({ status: "INACTIVE" });
    teacherCountMock.mockResolvedValue(1);

    const result = await updateClass("class-1", {}, validFormData());

    expect(result.formError).toBe("선택한 프로그램을 사용할 수 없습니다. 다시 선택해주세요.");
    expect(classTeacherFindManyMock).not.toHaveBeenCalled();
    expect(classTeacherCreateManyMock).not.toHaveBeenCalled();
    expect(classTeacherDeleteManyMock).not.toHaveBeenCalled();
  });

  it("rejects when a posted teacherId is not active and rolls back without touching ClassTeacher", async () => {
    programFindUniqueMock.mockResolvedValue({ status: "ACTIVE" });
    teacherCountMock.mockResolvedValue(0); // requested 1 teacherId, 0 are active

    const result = await updateClass("class-1", {}, validFormData());

    expect(result.formError).toBe("선택한 선생님 중 배정할 수 없는 선생님이 있습니다. 다시 선택해주세요.");
    expect(classTeacherFindManyMock).not.toHaveBeenCalled();
    expect(classTeacherCreateManyMock).not.toHaveBeenCalled();
    expect(classTeacherDeleteManyMock).not.toHaveBeenCalled();
  });

  it("proceeds to the ClassTeacher diff when the program and teachers are both usable", async () => {
    programFindUniqueMock.mockResolvedValue({ status: "ACTIVE" });
    teacherCountMock.mockResolvedValue(1);
    classTeacherFindManyMock.mockResolvedValue([{ teacherId: "teacher-1" }]);

    await expect(updateClass("class-1", {}, validFormData())).rejects.toThrow("REDIRECT");

    expect(classTeacherFindManyMock).toHaveBeenCalledTimes(1);
  });
});

describe("updateClass TOCTOU race: status changes after the pre-check but inside the transaction", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ user: { role: "ADMIN" } });
    // 트랜잭션 밖의 사전 체크 시점에는 아직 SCHEDULED였다고 가정한다 — 그래서 사전 체크는
    // 통과하지만, 트랜잭션 내부에서 조건부 updateMany 를 실행하는 시점에는 이미 다른 요청이
    // 먼저 상태를 바꿔버려 count: 0 이 반환되는 상황을 시뮬레이션한다.
    classFindUniqueMock.mockReset();
    classFindUniqueMock.mockResolvedValue({ status: "SCHEDULED" });
    programFindUniqueMock.mockReset();
    programFindUniqueMock.mockResolvedValue({ status: "ACTIVE" });
    teacherCountMock.mockReset();
    teacherCountMock.mockResolvedValue(1);
    transactionMock.mockReset();
    transactionMock.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));
    classUpdateManyMock.mockReset();
    classUpdateManyMock.mockResolvedValue({ count: 0 });
    classTeacherFindManyMock.mockReset();
    classTeacherCreateManyMock.mockReset();
    classTeacherDeleteManyMock.mockReset();
  });

  it("returns formError and never touches ClassTeacher when the transaction's conditional updateMany reports count: 0", async () => {
    const result = await updateClass("class-1", {}, validFormData());

    expect(result.formError).toBe("취소되었거나 완료된 클래스는 수정할 수 없습니다.");
    expect(classTeacherFindManyMock).not.toHaveBeenCalled();
    expect(classTeacherCreateManyMock).not.toHaveBeenCalled();
    expect(classTeacherDeleteManyMock).not.toHaveBeenCalled();
  });
});

function cancelFormData(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const base: Record<string, string> = {
    cancelReason: "WEATHER",
    cancelDetail: "",
    ...overrides,
  };
  for (const [key, value] of Object.entries(base)) {
    formData.set(key, value);
  }
  return formData;
}

describe("cancelClass", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    classFindUniqueMock.mockReset();
    classScheduleUpdateManyMock.mockReset();
  });

  it("rejects and never touches prisma when requireAdmin denies access", async () => {
    requireAdminMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(cancelClass("class-1", {}, cancelFormData())).rejects.toThrow("UNAUTHORIZED");
    expect(classFindUniqueMock).not.toHaveBeenCalled();
    expect(classScheduleUpdateManyMock).not.toHaveBeenCalled();
  });

  it("rejects re-cancelling a class that is already CANCELLED", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    classFindUniqueMock.mockResolvedValue({ status: "CANCELLED" });

    const result = await cancelClass("class-1", {}, cancelFormData());

    expect(result.formError).toBe("이미 취소되었거나 완료된 클래스는 다시 취소할 수 없습니다.");
    expect(classScheduleUpdateManyMock).not.toHaveBeenCalled();
  });

  it("rejects cancelling a class that is already COMPLETED", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    classFindUniqueMock.mockResolvedValue({ status: "COMPLETED" });

    const result = await cancelClass("class-1", {}, cancelFormData());

    expect(result.formError).toBe("이미 취소되었거나 완료된 클래스는 다시 취소할 수 없습니다.");
    expect(classScheduleUpdateManyMock).not.toHaveBeenCalled();
  });

  it("preserves the submitted cancelReason/cancelDetail in `values` when re-cancellation is rejected", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    classFindUniqueMock.mockResolvedValue({ status: "CANCELLED" });

    const result = await cancelClass(
      "class-1",
      {},
      cancelFormData({ cancelReason: "SAFETY", cancelDetail: "안전상 사유" }),
    );

    expect(result.values).toEqual({ cancelReason: "SAFETY", cancelDetail: "안전상 사유" });
  });

  it("rejects an invalid cancelReason code", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    classFindUniqueMock.mockResolvedValue({ status: "SCHEDULED" });

    const result = await cancelClass("class-1", {}, cancelFormData({ cancelReason: "NOT_A_REAL_REASON" }));

    expect(result.errors?.cancelReason).toBeDefined();
    expect(result.values).toEqual({ cancelReason: "NOT_A_REAL_REASON", cancelDetail: "" });
    expect(classScheduleUpdateManyMock).not.toHaveBeenCalled();
  });

  it("updates exactly status/cancelledAt/cancelReason/cancelDetail/cancelledById and nothing else, then redirects", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    classFindUniqueMock.mockResolvedValue({ status: "SCHEDULED" });
    classScheduleUpdateManyMock.mockResolvedValue({ count: 1 });

    await expect(
      cancelClass("class-1", {}, cancelFormData({ cancelReason: "OPERATION", cancelDetail: "운영진 사정" })),
    ).rejects.toThrow("REDIRECT");

    expect(classScheduleUpdateManyMock).toHaveBeenCalledTimes(1);
    const [[callArg]] = classScheduleUpdateManyMock.mock.calls;
    // status: "SCHEDULED" 조건부 where 로 상태 레이스를 막는다 — count 로 성공 여부를 판정한다.
    expect(callArg.where).toEqual({ id: "class-1", status: "SCHEDULED" });
    expect(Object.keys(callArg.data).sort()).toEqual(
      ["cancelDetail", "cancelReason", "cancelledAt", "cancelledById", "status"].sort(),
    );
    expect(callArg.data.status).toBe("CANCELLED");
    expect(callArg.data.cancelReason).toBe("OPERATION");
    expect(callArg.data.cancelDetail).toBe("운영진 사정");
    expect(callArg.data.cancelledById).toBe("admin-1");
    expect(callArg.data.cancelledAt).toBeInstanceOf(Date);
  });

  it("stores cancelDetail as null when left blank", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    classFindUniqueMock.mockResolvedValue({ status: "SCHEDULED" });
    classScheduleUpdateManyMock.mockResolvedValue({ count: 1 });

    await expect(
      cancelClass("class-1", {}, cancelFormData({ cancelReason: "WEATHER", cancelDetail: "" })),
    ).rejects.toThrow("REDIRECT");

    const [[callArg]] = classScheduleUpdateManyMock.mock.calls;
    expect(callArg.data.cancelDetail).toBeNull();
  });

  // TOCTOU: 트랜잭션 없이 findUnique 로 사전 체크만 하던 이전 구현은, 사전 체크 통과 후
  // updateMany 직전에 다른 취소 요청이 먼저 상태를 바꿔도 감지하지 못하고 조용히 덮어썼다.
  // 지금은 최종 쓰기 자체가 status: "SCHEDULED" 조건부 updateMany 이므로, 사전 체크가
  // SCHEDULED 를 봤더라도 실제 쓰기 시점에 count: 0 이 반환되면(레이스로 이미 취소된 것)
  // formError 로 처리해야 한다.
  it("returns formError when the conditional updateMany reports count: 0 even though the pre-check saw SCHEDULED", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    classFindUniqueMock.mockResolvedValue({ status: "SCHEDULED" });
    classScheduleUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await cancelClass("class-1", {}, cancelFormData());

    expect(result.formError).toBe("이미 취소되었거나 완료된 클래스는 다시 취소할 수 없습니다.");
  });
});

describe("no hard delete anywhere in the codebase", () => {
  it("app/ and lib/ never call prisma.classSchedule.delete", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(currentDir, "../../..");
    const targets = ["app", "lib"];
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          const content = readFileSync(full, "utf-8");
          if (/classSchedule\s*\.\s*delete\s*\(/.test(content)) {
            offenders.push(full);
          }
        }
      }
    }

    for (const target of targets) {
      walk(path.join(root, target));
    }

    expect(offenders).toEqual([]);
  });
});
