import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminMock = vi.fn();
const transactionMock = vi.fn();
const queryRawMock = vi.fn();
const childFindUniqueMock = vi.fn();
const reservationFindUniqueTxMock = vi.fn();
const reservationCountMock = vi.fn();
const reservationCreateMock = vi.fn();
const reservationUpdateMock = vi.fn();
const reservationFindUniqueMock = vi.fn();
const reservationUpdateManyMock = vi.fn();

const txMock = {
  $queryRaw: (...args: unknown[]) => queryRawMock(...args),
  child: {
    findUnique: (...args: unknown[]) => childFindUniqueMock(...args),
  },
  reservation: {
    findUnique: (...args: unknown[]) => reservationFindUniqueTxMock(...args),
    count: (...args: unknown[]) => reservationCountMock(...args),
    create: (...args: unknown[]) => reservationCreateMock(...args),
    update: (...args: unknown[]) => reservationUpdateMock(...args),
  },
};

vi.mock("@/lib/auth/authorization", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
    reservation: {
      findUnique: (...args: unknown[]) => reservationFindUniqueMock(...args),
      updateMany: (...args: unknown[]) => reservationUpdateManyMock(...args),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

const { cancelReservation, createReservation, createReservationCore } = await import(
  "@/app/(admin)/reservations/actions"
);
const {
  CapacityFullError,
  ChildNotActiveError,
  ChildNotFoundError,
  ClassNotFoundError,
  ClassNotScheduledError,
  DuplicateReservationError,
  TerminalReservationError,
} = await import("@/lib/reservations/errors");

function validFormData(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const base: Record<string, string> = {
    classScheduleId: "class-1",
    childId: "child-1",
    ...overrides,
  };
  for (const [key, value] of Object.entries(base)) {
    formData.set(key, value);
  }
  return formData;
}

function cancelFormData(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const base: Record<string, string> = {
    cancelReason: "PERSONAL",
    cancelDetail: "",
    ...overrides,
  };
  for (const [key, value] of Object.entries(base)) {
    formData.set(key, value);
  }
  return formData;
}

describe("reservations server actions require admin", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    transactionMock.mockReset();
    reservationFindUniqueMock.mockReset();
    reservationUpdateManyMock.mockReset();
  });

  it("createReservation rejects and never touches prisma when requireAdmin denies access", async () => {
    requireAdminMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(createReservation({}, validFormData())).rejects.toThrow("UNAUTHORIZED");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("cancelReservation rejects and never touches prisma when requireAdmin denies access", async () => {
    requireAdminMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(cancelReservation("reservation-1", {}, cancelFormData())).rejects.toThrow("UNAUTHORIZED");
    expect(reservationFindUniqueMock).not.toHaveBeenCalled();
    expect(reservationUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("createReservation validation", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    transactionMock.mockReset();
  });

  it("rejects a missing classScheduleId and never starts a transaction", async () => {
    const result = await createReservation({}, validFormData({ classScheduleId: "" }));

    expect(result.errors?.classScheduleId).toBeDefined();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects a missing childId and never starts a transaction", async () => {
    const result = await createReservation({}, validFormData({ childId: "" }));

    expect(result.errors?.childId).toBeDefined();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns the submitted raw values in `values` when validation fails", async () => {
    const result = await createReservation({}, validFormData({ classScheduleId: "", memo: "메모입니다" }));

    expect(result.values).toEqual({ classScheduleId: "", childId: "child-1", memo: "메모입니다" });
  });
});

describe("createReservationCore — 정원/상태/중복 검증 (QA 필수 테스트)", () => {
  beforeEach(() => {
    transactionMock.mockReset();
    transactionMock.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));
    queryRawMock.mockReset();
    childFindUniqueMock.mockReset();
    reservationFindUniqueTxMock.mockReset();
    reservationCountMock.mockReset();
    reservationCreateMock.mockReset();
    reservationUpdateMock.mockReset();
  });

  const prismaLike = {
    $transaction: (...args: unknown[]) => transactionMock(...args),
  } as unknown as Parameters<typeof createReservationCore>[0];

  it("정원 8명 초과 예약을 차단한다 (reservedCount === capacity)", async () => {
    queryRawMock.mockResolvedValue([{ status: "SCHEDULED", capacity: 8 }]);
    childFindUniqueMock.mockResolvedValue({ isActive: true });
    reservationFindUniqueTxMock.mockResolvedValue(null);
    reservationCountMock.mockResolvedValue(8);

    await expect(
      createReservationCore(prismaLike, { classScheduleId: "class-1", childId: "child-1" }),
    ).rejects.toBeInstanceOf(CapacityFullError);
    expect(reservationCreateMock).not.toHaveBeenCalled();
  });

  it("정원 미달(reservedCount === capacity - 1)이면 마지막 한 자리를 예약할 수 있다", async () => {
    queryRawMock.mockResolvedValue([{ status: "SCHEDULED", capacity: 8 }]);
    childFindUniqueMock.mockResolvedValue({ isActive: true });
    reservationFindUniqueTxMock.mockResolvedValue(null);
    reservationCountMock.mockResolvedValue(7);
    reservationCreateMock.mockResolvedValue({ id: "reservation-new" });

    const result = await createReservationCore(prismaLike, {
      classScheduleId: "class-1",
      childId: "child-1",
    });

    expect(result).toEqual({ id: "reservation-new" });
    expect(reservationCreateMock).toHaveBeenCalledTimes(1);
  });

  it("취소된 클래스에 신규 예약을 차단한다", async () => {
    queryRawMock.mockResolvedValue([{ status: "CANCELLED", capacity: 8 }]);

    await expect(
      createReservationCore(prismaLike, { classScheduleId: "class-1", childId: "child-1" }),
    ).rejects.toBeInstanceOf(ClassNotScheduledError);
    expect(childFindUniqueMock).not.toHaveBeenCalled();
    expect(reservationCreateMock).not.toHaveBeenCalled();
  });

  it("완료된 클래스에 신규 예약을 차단한다", async () => {
    queryRawMock.mockResolvedValue([{ status: "COMPLETED", capacity: 8 }]);

    await expect(
      createReservationCore(prismaLike, { classScheduleId: "class-1", childId: "child-1" }),
    ).rejects.toBeInstanceOf(ClassNotScheduledError);
  });

  // ADR-026/027: DB status는 클래스가 끝나도 SCHEDULED로 남는다 — endsAt이 과거인
  // (표시상 ENDED) 클래스에 새로 예약하는 것도 취소/완료된 클래스와 동일하게 막아야 한다.
  it("DB status는 SCHEDULED지만 endsAt이 과거인(표시상 종료된) 클래스에 신규 예약을 차단한다", async () => {
    queryRawMock.mockResolvedValue([
      { status: "SCHEDULED", capacity: 8, endsAt: new Date("2020-01-01T00:00:00Z") },
    ]);

    await expect(
      createReservationCore(prismaLike, { classScheduleId: "class-1", childId: "child-1" }),
    ).rejects.toBeInstanceOf(ClassNotScheduledError);
    expect(childFindUniqueMock).not.toHaveBeenCalled();
    expect(reservationCreateMock).not.toHaveBeenCalled();
  });

  it("DB status가 SCHEDULED이고 endsAt이 미래인 클래스는 정상적으로 예약할 수 있다", async () => {
    queryRawMock.mockResolvedValue([
      { status: "SCHEDULED", capacity: 8, endsAt: new Date("2099-01-01T00:00:00Z") },
    ]);
    childFindUniqueMock.mockResolvedValue({ isActive: true });
    reservationFindUniqueTxMock.mockResolvedValue(null);
    reservationCountMock.mockResolvedValue(0);
    reservationCreateMock.mockResolvedValue({ id: "reservation-new" });

    const result = await createReservationCore(prismaLike, {
      classScheduleId: "class-1",
      childId: "child-1",
    });

    expect(result).toEqual({ id: "reservation-new" });
  });

  it("존재하지 않는 클래스는 ClassNotFoundError 를 던진다", async () => {
    queryRawMock.mockResolvedValue([]);

    await expect(
      createReservationCore(prismaLike, { classScheduleId: "class-missing", childId: "child-1" }),
    ).rejects.toBeInstanceOf(ClassNotFoundError);
  });

  it("비활성 아이의 신규 예약을 차단한다", async () => {
    queryRawMock.mockResolvedValue([{ status: "SCHEDULED", capacity: 8 }]);
    childFindUniqueMock.mockResolvedValue({ isActive: false });

    await expect(
      createReservationCore(prismaLike, { classScheduleId: "class-1", childId: "child-1" }),
    ).rejects.toBeInstanceOf(ChildNotActiveError);
    expect(reservationFindUniqueTxMock).not.toHaveBeenCalled();
    expect(reservationCreateMock).not.toHaveBeenCalled();
  });

  it("존재하지 않는 아이는 ChildNotFoundError 를 던진다", async () => {
    queryRawMock.mockResolvedValue([{ status: "SCHEDULED", capacity: 8 }]);
    childFindUniqueMock.mockResolvedValue(null);

    await expect(
      createReservationCore(prismaLike, { classScheduleId: "class-1", childId: "child-missing" }),
    ).rejects.toBeInstanceOf(ChildNotFoundError);
  });

  it("동일 아이의 동일 클래스 중복 예약(기존 RESERVED)을 차단한다", async () => {
    queryRawMock.mockResolvedValue([{ status: "SCHEDULED", capacity: 8 }]);
    childFindUniqueMock.mockResolvedValue({ isActive: true });
    reservationFindUniqueTxMock.mockResolvedValue({ id: "reservation-existing", status: "RESERVED" });

    await expect(
      createReservationCore(prismaLike, { classScheduleId: "class-1", childId: "child-1" }),
    ).rejects.toBeInstanceOf(DuplicateReservationError);
    expect(reservationCountMock).not.toHaveBeenCalled();
    expect(reservationCreateMock).not.toHaveBeenCalled();
  });

  it("이미 종료된(COMPLETED) 예약에 대한 재예약을 차단한다", async () => {
    queryRawMock.mockResolvedValue([{ status: "SCHEDULED", capacity: 8 }]);
    childFindUniqueMock.mockResolvedValue({ isActive: true });
    reservationFindUniqueTxMock.mockResolvedValue({ id: "reservation-existing", status: "COMPLETED" });

    await expect(
      createReservationCore(prismaLike, { classScheduleId: "class-1", childId: "child-1" }),
    ).rejects.toBeInstanceOf(TerminalReservationError);
  });

  it("이미 종료된(NO_SHOW) 예약에 대한 재예약을 차단한다", async () => {
    queryRawMock.mockResolvedValue([{ status: "SCHEDULED", capacity: 8 }]);
    childFindUniqueMock.mockResolvedValue({ isActive: true });
    reservationFindUniqueTxMock.mockResolvedValue({ id: "reservation-existing", status: "NO_SHOW" });

    await expect(
      createReservationCore(prismaLike, { classScheduleId: "class-1", childId: "child-1" }),
    ).rejects.toBeInstanceOf(TerminalReservationError);
  });

  it("취소된 기존 예약(CANCELLED)은 새 행을 만들지 않고 기존 행을 RESERVED 로 재활성화한다 (ADR-024)", async () => {
    queryRawMock.mockResolvedValue([{ status: "SCHEDULED", capacity: 8 }]);
    childFindUniqueMock.mockResolvedValue({ isActive: true });
    reservationFindUniqueTxMock.mockResolvedValue({ id: "reservation-existing", status: "CANCELLED" });
    reservationCountMock.mockResolvedValue(0);
    reservationUpdateMock.mockResolvedValue({ id: "reservation-existing" });

    const result = await createReservationCore(prismaLike, { classScheduleId: "class-1", childId: "child-1" });

    expect(result).toEqual({ id: "reservation-existing" });
    expect(reservationCreateMock).not.toHaveBeenCalled();
    expect(reservationUpdateMock).toHaveBeenCalledTimes(1);
    const [[callArg]] = reservationUpdateMock.mock.calls;
    expect(callArg.where).toEqual({ id: "reservation-existing" });
    expect(callArg.data).toMatchObject({
      status: "RESERVED",
      cancelledAt: null,
      cancelReason: null,
      cancelDetail: null,
      cancelledById: null,
    });
  });
});

describe("createReservation (Server Action) maps core errors to user-facing formError", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    transactionMock.mockReset();
    transactionMock.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));
    queryRawMock.mockReset();
    childFindUniqueMock.mockReset();
    reservationFindUniqueTxMock.mockReset();
    reservationCountMock.mockReset();
    reservationCreateMock.mockReset();
  });

  it("maps ClassNotScheduledError", async () => {
    queryRawMock.mockResolvedValue([{ status: "CANCELLED", capacity: 8 }]);

    const result = await createReservation({}, validFormData());

    expect(result.formError).toBe("취소되었거나 완료된 클래스에는 예약할 수 없습니다.");
  });

  it("maps ChildNotActiveError", async () => {
    queryRawMock.mockResolvedValue([{ status: "SCHEDULED", capacity: 8 }]);
    childFindUniqueMock.mockResolvedValue({ isActive: false });

    const result = await createReservation({}, validFormData());

    expect(result.formError).toBe("비활성화된 아이는 새로 예약할 수 없습니다.");
  });

  it("maps DuplicateReservationError", async () => {
    queryRawMock.mockResolvedValue([{ status: "SCHEDULED", capacity: 8 }]);
    childFindUniqueMock.mockResolvedValue({ isActive: true });
    reservationFindUniqueTxMock.mockResolvedValue({ id: "r1", status: "RESERVED" });

    const result = await createReservation({}, validFormData());

    expect(result.formError).toBe("이미 이 클래스에 예약된 아이입니다.");
  });

  it("maps TerminalReservationError", async () => {
    queryRawMock.mockResolvedValue([{ status: "SCHEDULED", capacity: 8 }]);
    childFindUniqueMock.mockResolvedValue({ isActive: true });
    reservationFindUniqueTxMock.mockResolvedValue({ id: "r1", status: "COMPLETED" });

    const result = await createReservation({}, validFormData());

    expect(result.formError).toBe("이미 종료된 예약입니다. 관리자에게 문의해주세요.");
  });

  it("maps CapacityFullError", async () => {
    queryRawMock.mockResolvedValue([{ status: "SCHEDULED", capacity: 1 }]);
    childFindUniqueMock.mockResolvedValue({ isActive: true });
    reservationFindUniqueTxMock.mockResolvedValue(null);
    reservationCountMock.mockResolvedValue(1);

    const result = await createReservation({}, validFormData());

    expect(result.formError).toBe("정원이 가득 찼습니다.");
  });

  it("maps ClassNotFoundError/ChildNotFoundError to a shared not-found message", async () => {
    queryRawMock.mockResolvedValue([]);

    const result = await createReservation({}, validFormData());

    expect(result.formError).toBe("선택한 클래스 또는 아이를 찾을 수 없습니다.");
  });

  it("redirects to the detail page on success", async () => {
    queryRawMock.mockResolvedValue([{ status: "SCHEDULED", capacity: 8 }]);
    childFindUniqueMock.mockResolvedValue({ isActive: true });
    reservationFindUniqueTxMock.mockResolvedValue(null);
    reservationCountMock.mockResolvedValue(0);
    reservationCreateMock.mockResolvedValue({ id: "reservation-new" });

    await expect(createReservation({}, validFormData())).rejects.toThrow("REDIRECT");
  });
});

describe("cancelReservation", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    reservationFindUniqueMock.mockReset();
    reservationUpdateManyMock.mockReset();
  });

  it("rejects re-cancelling a reservation that is already CANCELLED", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    reservationFindUniqueMock.mockResolvedValue({ status: "CANCELLED" });

    const result = await cancelReservation("reservation-1", {}, cancelFormData());

    expect(result.formError).toBe("이미 취소되었거나 취소할 수 없는 예약입니다.");
    expect(reservationUpdateManyMock).not.toHaveBeenCalled();
  });

  it("allows cancelling a COMPLETED reservation and preserves attendance fields", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    // COMPLETED 는 이미 끝난 클래스에서만 나올 수 있는 상태이므로 소속 클래스의 endsAt 도
    // 과거로 함께 준다 — getReservationDisplayStatus 는 클래스가 끝났는지로 판단한다.
    reservationFindUniqueMock.mockResolvedValue({
      status: "COMPLETED",
      classSchedule: { status: "SCHEDULED", endsAt: new Date("2020-01-01T00:00:00Z") },
    });

    reservationUpdateManyMock.mockResolvedValue({ count: 1 });
    await expect(cancelReservation("reservation-1", {}, cancelFormData())).rejects.toThrow("REDIRECT");
    const [[callArg]] = reservationUpdateManyMock.mock.calls;
    expect(callArg.where.OR[1]).toEqual({ status: { in: ["COMPLETED", "NO_SHOW"] } });
    expect(callArg.data).not.toHaveProperty("attendance");
    expect(callArg.data).not.toHaveProperty("attendanceRecordedById");
    expect(callArg.data).not.toHaveProperty("attendanceRecordedAt");
  });

  it("allows cancelling a NO_SHOW reservation", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    reservationFindUniqueMock.mockResolvedValue({
      status: "NO_SHOW",
      classSchedule: { status: "SCHEDULED", endsAt: new Date("2020-01-01T00:00:00Z") },
    });

    reservationUpdateManyMock.mockResolvedValue({ count: 1 });
    await expect(cancelReservation("reservation-1", {}, cancelFormData())).rejects.toThrow("REDIRECT");
  });

  it("returns not-found formError when the reservation does not exist", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    reservationFindUniqueMock.mockResolvedValue(null);

    const result = await cancelReservation("reservation-missing", {}, cancelFormData());

    expect(result.formError).toBe("예약을 찾을 수 없습니다.");
  });

  it("rejects an invalid cancelReason code", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    reservationFindUniqueMock.mockResolvedValue({
      status: "RESERVED",
      classSchedule: { status: "SCHEDULED", endsAt: new Date("2099-01-01T00:00:00Z") },
    });

    const result = await cancelReservation(
      "reservation-1",
      {},
      cancelFormData({ cancelReason: "NOT_A_REAL_REASON" }),
    );

    expect(result.errors?.cancelReason).toBeDefined();
    expect(reservationUpdateManyMock).not.toHaveBeenCalled();
  });

  it("updates exactly status/cancelledAt/cancelReason/cancelDetail/cancelledById and redirects", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    reservationFindUniqueMock.mockResolvedValue({
      status: "RESERVED",
      classSchedule: { status: "SCHEDULED", endsAt: new Date("2099-01-01T00:00:00Z") },
    });
    reservationUpdateManyMock.mockResolvedValue({ count: 1 });

    await expect(
      cancelReservation(
        "reservation-1",
        {},
        cancelFormData({ cancelReason: "SCHEDULE", cancelDetail: "일정이 바뀌었어요" }),
      ),
    ).rejects.toThrow("REDIRECT");

    expect(reservationUpdateManyMock).toHaveBeenCalledTimes(1);
    const [[callArg]] = reservationUpdateManyMock.mock.calls;
    expect(callArg.where.id).toBe("reservation-1");
    expect(callArg.where.OR[0]).toEqual({
      status: "RESERVED",
      classSchedule: { status: "SCHEDULED", endsAt: { gte: expect.any(Date) } },
    });
    expect(Object.keys(callArg.data).sort()).toEqual(
      ["cancelDetail", "cancelReason", "cancelledAt", "cancelledById", "status"].sort(),
    );
    expect(callArg.data.status).toBe("CANCELLED");
    expect(callArg.data.cancelReason).toBe("SCHEDULE");
    expect(callArg.data.cancelDetail).toBe("일정이 바뀌었어요");
    expect(callArg.data.cancelledById).toBe("admin-1");
    expect(callArg.data.cancelledAt).toBeInstanceOf(Date);
  });

  it("stores cancelDetail as null when left blank", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    reservationFindUniqueMock.mockResolvedValue({
      status: "RESERVED",
      classSchedule: { status: "SCHEDULED", endsAt: new Date("2099-01-01T00:00:00Z") },
    });
    reservationUpdateManyMock.mockResolvedValue({ count: 1 });

    await expect(
      cancelReservation("reservation-1", {}, cancelFormData({ cancelReason: "WEATHER", cancelDetail: "" })),
    ).rejects.toThrow("REDIRECT");

    const [[callArg]] = reservationUpdateManyMock.mock.calls;
    expect(callArg.data.cancelDetail).toBeNull();
  });

  // TOCTOU: 사전 findUnique 는 RESERVED 를 봤지만, 실제 조건부 updateMany 시점에 다른 요청이 먼저
  // 취소했을 수 있다 — count: 0 이면 formError 로 처리해야 한다.
  it("returns formError when the conditional updateMany reports count: 0 even though the pre-check saw RESERVED", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    reservationFindUniqueMock.mockResolvedValue({
      status: "RESERVED",
      classSchedule: { status: "SCHEDULED", endsAt: new Date("2099-01-01T00:00:00Z") },
    });
    reservationUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await cancelReservation("reservation-1", {}, cancelFormData());

    expect(result.formError).toBe("이미 취소되었거나 취소할 수 없는 예약입니다.");
  });

  // 회귀 테스트: Reservation.status 는 계속 RESERVED 로 남지만, 소속 클래스가 이미 끝났으면
  // (endsAt 과거) getReservationDisplayStatus 기준 ENDED 로 계산되어 취소도 막아야 한다.
  it("rejects cancelling a reservation whose class already ended, even though reservation.status is still RESERVED", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    reservationFindUniqueMock.mockResolvedValue({
      status: "RESERVED",
      classSchedule: { status: "SCHEDULED", endsAt: new Date("2020-01-01T00:00:00Z") },
    });

    const result = await cancelReservation("reservation-1", {}, cancelFormData());

    expect(result.formError).toBe("이미 취소되었거나 취소할 수 없는 예약입니다.");
    expect(reservationUpdateManyMock).not.toHaveBeenCalled();
  });

  it("preserves the submitted cancelReason/cancelDetail in `values` when rejected", async () => {
    requireAdminMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    reservationFindUniqueMock.mockResolvedValue({ status: "CANCELLED" });

    const result = await cancelReservation(
      "reservation-1",
      {},
      cancelFormData({ cancelReason: "ILLNESS", cancelDetail: "감기" }),
    );

    expect(result.values).toEqual({ cancelReason: "ILLNESS", cancelDetail: "감기" });
  });
});

describe("no hard delete anywhere in the reservations codebase", () => {
  it("app/ and lib/ never call prisma.reservation.delete", async () => {
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
          if (/reservation\s*\.\s*delete\s*\(/.test(content)) {
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
