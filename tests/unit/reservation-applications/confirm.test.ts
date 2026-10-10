import { describe, expect, it, vi } from "vitest";
import {
  ApplicationDepositNotConfirmedError,
  ApplicationNotFoundError,
  ApplicationNotPendingError,
} from "@/lib/reservation-applications/errors";
import {
  ChildNotActiveError,
  ChildNotFoundError,
  OverbookingConfirmationRequiredError,
} from "@/lib/reservations/errors";
import {
  confirmReservationApplicationCore,
  type ConfirmReservationApplicationInput,
} from "@/server/reservation-applications/confirm";
import { ChildPersonalDataPurgedError } from "@/lib/children/errors";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const SUBMITTED_AT = new Date("2026-09-30T01:00:00.000Z");
const DEPOSIT_AT = new Date("2026-09-30T05:00:00.000Z");
// createReservationInTransaction 은 실제 현재 시각으로 종료 여부를 판정하므로 실제 미래 시각을 쓴다.
const CLASS_ENDS_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

type TxOptions = {
  lock?: Array<{ status: string; depositConfirmedAt: Date | null; submissionId?: string | null }>;
  photoShareConsentAgreed?: boolean;
  photoMarketingConsentAgreed?: boolean;
  currentShareAction?: "AGREED" | "REVOKED" | "DECLINED" | null;
  purged?: boolean;
  capacity?: number;
  reservedCount?: number;
  existingChild?: { id: string; isActive: boolean; personalDataPurgedAt?: Date | null } | null;
  /** 잠금 전 조회 뒤 파기가 커밋되어, Child 잠금이 파기된 행을 돌려주는 경우 */
  purgedBeforeChildLock?: boolean;
  currentMarketingAction?: "AGREED" | "REVOKED" | "DECLINED" | null;
  existingReservation?: { id: string; status: string } | null;
  applicationUpdateCount?: number;
};

function createTx(options: TxOptions = {}) {
  const existingChild =
    options.existingChild === undefined
      ? { id: "child-existing", isActive: true, personalDataPurgedAt: null }
      : options.existingChild;
  const rawSqlLog: string[] = [];

  // 신청 행 잠금 → ClassSchedule 잠금 → Child FOR SHARE 잠금(ADR-058)을 SQL 로 구분해 응답한다.
  const queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    rawSqlLog.push(sql);
    if (sql.includes('FROM "ReservationApplication"')) {
      return options.lock ?? [{ status: "SUBMITTED", depositConfirmedAt: DEPOSIT_AT }];
    }
    if (sql.includes('FROM "ClassSchedule"')) {
      return [{ status: "SCHEDULED", capacity: options.capacity ?? 8, endsAt: CLASS_ENDS_AT }];
    }
    if (sql.includes('FROM "Child"')) {
      const [childId] = values;
      if (childId === "child-new") return [{ isActive: true, personalDataPurgedAt: null }];
      if (!existingChild || existingChild.id !== childId) return [];
      return options.purgedBeforeChildLock
        ? [{ isActive: false, personalDataPurgedAt: new Date("2031-01-01T00:00:00Z") }]
        : [{ isActive: existingChild.isActive, personalDataPurgedAt: existingChild.personalDataPurgedAt ?? null }];
    }
    throw new Error(`unexpected raw query: ${sql}`);
  });

  const tx = {
    $queryRaw: queryRaw,
    reservationApplication: {
      findUniqueOrThrow: vi.fn(async () => ({
        classScheduleId: "class-1",
        childName: options.purged ? null : "테스트아이",
        childBirthDate: new Date("2019-05-01"),
        childGender: "FEMALE",
        guardianName: "테스트보호자",
        guardianPhone: "010-0000-0000",
        photoShareConsentAgreed: options.photoShareConsentAgreed ?? true,
        photoMarketingConsentAgreed: options.photoMarketingConsentAgreed ?? true,
        submittedAt: SUBMITTED_AT,
      })),
      updateMany: vi.fn(async () => ({ count: options.applicationUpdateCount ?? 1 })),
    },
    child: {
      create: vi.fn(async () => ({ id: "child-new" })),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === "child-new") return { id: "child-new", isActive: true };
        return existingChild && existingChild.id === where.id ? existingChild : null;
      }),
    },
    childConsent: {
      findFirst: vi.fn(async ({ where }: { where: { consentType: string } }) => {
        const action = where.consentType === "PHOTO_SHARE" ? options.currentShareAction : options.currentMarketingAction;
        return action ? { action } : null;
      }),
      createMany: vi.fn(async () => ({ count: 3 })),
    },
    reservation: {
      findUnique: vi.fn(async () => options.existingReservation ?? null),
      count: vi.fn(async () => options.reservedCount ?? 0),
      create: vi.fn(async () => ({ id: "reservation-new" })),
      update: vi.fn(async () => ({ id: options.existingReservation?.id ?? "reservation-existing" })),
    },
  };
  const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
  return { client: { $transaction: transaction } as never, tx, rawSqlLog };
}

function input(overrides: Partial<ConfirmReservationApplicationInput> = {}): ConfirmReservationApplicationInput {
  return {
    applicationId: "application-1",
    childChoice: { type: "NEW" },
    memo: "요청사항 메모",
    confirmOverbooking: false,
    actorUserId: "admin-1",
    now: NOW,
    ...overrides,
  };
}

describe("confirmReservationApplicationCore", () => {
  it("registers a new child from the application and creates the reservation, consents and link", async () => {
    const { client, tx } = createTx();

    await expect(confirmReservationApplicationCore(client, input())).resolves.toEqual({
      reservationId: "reservation-new",
      childId: "child-new",
    });

    expect(tx.child.create).toHaveBeenCalledWith({
      data: {
        name: "테스트아이",
        birthDate: new Date("2019-05-01"),
        gender: "FEMALE",
        guardianName: "테스트보호자",
        guardianPhone: "010-0000-0000",
      },
      select: { id: true },
    });
    expect(tx.reservation.create).toHaveBeenCalledWith({
      data: { classScheduleId: "class-1", childId: "child-new", memo: "요청사항 메모", status: "RESERVED" },
      select: { id: true },
    });
    expect(tx.childConsent.createMany).toHaveBeenCalledWith({
      data: ["PRIVACY", "PHOTO_SHARE", "PHOTO_MARKETING"].map((consentType) => ({
        childId: "child-new",
        consentType,
        action: "AGREED",
        recordedAt: SUBMITTED_AT,
        recordedById: "admin-1",
        reservationApplicationId: "application-1",
      })),
    });
    expect(tx.reservationApplication.updateMany).toHaveBeenCalledWith({
      where: { id: "application-1", status: "SUBMITTED" },
      data: {
        status: "CONFIRMED",
        childId: "child-new",
        reservationId: "reservation-new",
        resolvedAt: NOW,
        resolvedById: "admin-1",
      },
    });
    expect(tx.childConsent.findFirst).not.toHaveBeenCalled();
  });

  it("links an existing child without changing it and revokes an outdated marketing agreement", async () => {
    const { client, tx } = createTx({ photoMarketingConsentAgreed: false, currentMarketingAction: "AGREED" });

    await confirmReservationApplicationCore(
      client,
      input({ childChoice: { type: "EXISTING", childId: "child-existing" } }),
    );

    expect(tx.child.create).not.toHaveBeenCalled();
    expect(tx.childConsent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ consentType: "PRIVACY", action: "AGREED", childId: "child-existing" }),
        expect.objectContaining({ consentType: "PHOTO_SHARE", action: "AGREED", childId: "child-existing" }),
        expect.objectContaining({
          consentType: "PHOTO_MARKETING",
          action: "REVOKED",
          recordedAt: SUBMITTED_AT,
          childId: "child-existing",
        }),
      ],
    });
  });

  it("records declined optional consents for a new child instead of leaving them unrecorded", async () => {
    const { client, tx } = createTx({ photoShareConsentAgreed: false, photoMarketingConsentAgreed: false });

    await confirmReservationApplicationCore(client, input());

    expect(tx.childConsent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ consentType: "PRIVACY", action: "AGREED", childId: "child-new" }),
        expect.objectContaining({ consentType: "PHOTO_SHARE", action: "DECLINED", childId: "child-new" }),
        expect.objectContaining({ consentType: "PHOTO_MARKETING", action: "DECLINED", childId: "child-new" }),
      ],
    });
  });

  it("appends a withdrawal for an existing photo sharing agreement and a decline when none existed", async () => {
    const { client, tx } = createTx({
      photoShareConsentAgreed: false,
      photoMarketingConsentAgreed: false,
      currentShareAction: "AGREED",
      currentMarketingAction: "REVOKED",
    });

    await confirmReservationApplicationCore(
      client,
      input({ childChoice: { type: "EXISTING", childId: "child-existing" } }),
    );

    expect(tx.childConsent.findFirst).toHaveBeenCalledTimes(2);
    const [{ data }] = tx.childConsent.createMany.mock.calls[0] as unknown as [
      { data: Array<{ consentType: string; action: string; recordedAt: Date }> },
    ];
    expect(data.map((row) => `${row.consentType}:${row.action}`)).toEqual([
      "PRIVACY:AGREED",
      "PHOTO_SHARE:REVOKED",
      "PHOTO_MARKETING:DECLINED",
    ]);
    for (const row of data) expect(row.recordedAt).toEqual(SUBMITTED_AT);
  });

  it("refuses to confirm an application whose personal data is missing", async () => {
    const { client, tx } = createTx({ purged: true });

    await expect(confirmReservationApplicationCore(client, input())).rejects.toBeInstanceOf(ApplicationNotPendingError);
    expect(tx.child.create).not.toHaveBeenCalled();
    expect(tx.reservation.create).not.toHaveBeenCalled();
  });

  it.each<[string, Array<{ status: string; depositConfirmedAt: Date | null }>, new () => Error]>([
    ["missing application", [], ApplicationNotFoundError],
    ["already processed application", [{ status: "CONFIRMED", depositConfirmedAt: DEPOSIT_AT }], ApplicationNotPendingError],
    ["unconfirmed deposit", [{ status: "SUBMITTED", depositConfirmedAt: null }], ApplicationDepositNotConfirmedError],
  ])("rejects a %s before any write", async (_label, lock, errorType) => {
    const { client, tx } = createTx({ lock });

    await expect(confirmReservationApplicationCore(client, input())).rejects.toBeInstanceOf(errorType);
    expect(tx.child.create).not.toHaveBeenCalled();
    expect(tx.reservation.create).not.toHaveBeenCalled();
    expect(tx.childConsent.createMany).not.toHaveBeenCalled();
    expect(tx.reservationApplication.updateMany).not.toHaveBeenCalled();
  });

  it("does not allow the legacy single-application confirmer to process a parent submission child", async () => {
    const { client, tx } = createTx({ lock: [{ status: "SUBMITTED", depositConfirmedAt: DEPOSIT_AT, submissionId: "submission-1" }] });

    await expect(confirmReservationApplicationCore(client, input())).rejects.toBeInstanceOf(ApplicationNotPendingError);
    expect(tx.reservation.create).not.toHaveBeenCalled();
    expect(tx.reservationApplication.updateMany).not.toHaveBeenCalled();
  });

  it("requires explicit overbooking confirmation when the class is full", async () => {
    const full = createTx({ capacity: 2, reservedCount: 2 });
    await expect(confirmReservationApplicationCore(full.client, input())).rejects.toBeInstanceOf(
      OverbookingConfirmationRequiredError,
    );
    expect(full.tx.childConsent.createMany).not.toHaveBeenCalled();
    expect(full.tx.reservationApplication.updateMany).not.toHaveBeenCalled();

    const confirmed = createTx({ capacity: 2, reservedCount: 2 });
    await expect(
      confirmReservationApplicationCore(confirmed.client, input({ confirmOverbooking: true })),
    ).resolves.toEqual({ reservationId: "reservation-new", childId: "child-new" });
  });

  it("reuses a cancelled reservation row (ADR-024) and records its id on the application", async () => {
    const { client, tx } = createTx({ existingReservation: { id: "reservation-old", status: "CANCELLED" } });

    await expect(
      confirmReservationApplicationCore(client, input({ childChoice: { type: "EXISTING", childId: "child-existing" } })),
    ).resolves.toEqual({ reservationId: "reservation-old", childId: "child-existing" });
    expect(tx.reservation.create).not.toHaveBeenCalled();
    expect(tx.reservationApplication.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reservationId: "reservation-old" }) }),
    );
  });

  it("keeps existing reservation rules for missing or inactive children", async () => {
    const missing = createTx({ existingChild: null });
    await expect(
      confirmReservationApplicationCore(missing.client, input({ childChoice: { type: "EXISTING", childId: "gone" } })),
    ).rejects.toBeInstanceOf(ChildNotFoundError);

    const inactive = createTx({ existingChild: { id: "child-inactive", isActive: false } });
    await expect(
      confirmReservationApplicationCore(
        inactive.client,
        input({ childChoice: { type: "EXISTING", childId: "child-inactive" } }),
      ),
    ).rejects.toBeInstanceOf(ChildNotActiveError);
    expect(inactive.tx.childConsent.createMany).not.toHaveBeenCalled();
  });

  it("locks the application, then the class, then the child row (ADR-058)", async () => {
    const { client, rawSqlLog } = createTx();

    await confirmReservationApplicationCore(client, input({ childChoice: { type: "EXISTING", childId: "child-existing" } }));

    expect(rawSqlLog).toHaveLength(3);
    expect(rawSqlLog[0]).toMatch(/FROM "ReservationApplication" WHERE "id" = \? FOR UPDATE/);
    expect(rawSqlLog[1]).toMatch(/FROM "ClassSchedule" WHERE "id" = \? FOR UPDATE/);
    expect(rawSqlLog[2]).toMatch(/FROM "Child" WHERE "id" = \? FOR SHARE/);
  });

  it("refuses a purged existing child with its own error before any write (MSG-1)", async () => {
    const { client, tx } = createTx({
      existingChild: { id: "child-purged", isActive: false, personalDataPurgedAt: new Date("2031-01-01T00:00:00Z") },
    });

    await expect(
      confirmReservationApplicationCore(client, input({ childChoice: { type: "EXISTING", childId: "child-purged" } })),
    ).rejects.toBeInstanceOf(ChildPersonalDataPurgedError);
    expect(tx.reservation.create).not.toHaveBeenCalled();
    expect(tx.childConsent.createMany).not.toHaveBeenCalled();
    expect(tx.reservationApplication.updateMany).not.toHaveBeenCalled();
  });

  it("re-checks the child under the row lock when a purge commits after the first read (CONC-1)", async () => {
    const { client, tx } = createTx({ purgedBeforeChildLock: true });

    await expect(
      confirmReservationApplicationCore(client, input({ childChoice: { type: "EXISTING", childId: "child-existing" } })),
    ).rejects.toBeInstanceOf(ChildPersonalDataPurgedError);
    expect(tx.reservation.create).not.toHaveBeenCalled();
    expect(tx.reservation.update).not.toHaveBeenCalled();
    expect(tx.childConsent.createMany).not.toHaveBeenCalled();
    expect(tx.reservationApplication.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed if another request processed the application first", async () => {
    const { client } = createTx({ applicationUpdateCount: 0 });
    await expect(confirmReservationApplicationCore(client, input())).rejects.toBeInstanceOf(
      ApplicationNotPendingError,
    );
  });
});
