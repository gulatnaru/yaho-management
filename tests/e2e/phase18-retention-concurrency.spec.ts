import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { recordChildConsentCore, recordChildConsentInTransaction } from "@/server/children/consent";
import { upsertChildSafetyInfoCore, upsertChildSafetyInfoInTransaction } from "@/server/children/safety-info";
import {
  purgeExpiredPersonalDataCore,
  purgeExpiredPersonalDataInTransaction,
  type PersonalDataPurgeResult,
} from "@/server/reservation-applications/retention";
import { createReservationCore, createReservationInTransaction } from "@/server/reservations/create";

/**
 * Phase 18 개인정보 파기 동시성 검증(ADR-058, CONC-1). 브라우저 없이 실제 로컬 E2E DB(ADR-009, db-safety)에서
 * 두 트랜잭션을 겹쳐 실행한다. 한쪽 트랜잭션을 잠금을 쥔 채 멈추고, 다른 쪽이 pg_stat_activity 에서 행 잠금을
 * 기다리는 것을 확인한 뒤 풀어 준다 — 잠금 규약이 없으면 기다림이 생기지 않아 테스트가 실패한다.
 *
 * 금지 상태: "미래 예약(RESERVED + 예정 클래스)이 있는 파기된 아이", "파기된 아이의 동의이력·안전정보".
 * 파기는 DB 전체의 만료 대상에 적용되므로 전용 로컬 E2E DB 에서만 실행한다(playwright.config.ts 가 확인한다).
 * 테스트 데이터는 모두 합성 값이다.
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
if (!ADMIN_EMAIL) {
  throw new Error("ADMIN_EMAIL 환경변수가 필요합니다.");
}
const adminEmail: string = ADMIN_EMAIL;

// 서로 다른 커넥션 풀에서 트랜잭션을 겹쳐 실행한다.
const observer = new PrismaClient();
const clientA = new PrismaClient();
const clientB = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
const GATED_TRANSACTION = { maxWait: 10_000, timeout: 60_000 };
const marker = `P18C_${randomUUID().slice(0, 8)}`;
const guardianPhone = "010-0000-5858";

const fixtures = {
  programId: "",
  oldClassId: "",
  futureClassId: "",
  adminUserId: "",
  children: [] as string[],
};

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 다른 트랜잭션이 행 잠금을 기다리기 시작할 때까지 기다린다. */
async function waitForLockWaiter(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await observer.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS "waiting"
      FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    if ((row?.waiting ?? 0) > 0) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error("상대 트랜잭션이 Child 행 잠금을 기다리지 않았습니다 — 잠금 규약(ADR-058)이 빠졌습니다.");
}

/** 마지막 예약 수업일이 약 10년 전인, Phase 18 확정 신청 이력이 있는 고객(5년 보관 만료 대상) */
async function createExpiredCustomer(label: string) {
  const child = await observer.child.create({
    data: {
      name: `${label}_${marker}`,
      guardianName: `보호자_${marker}`,
      guardianPhone,
      safetyInfo: { create: { allergies: `합성 알레르기_${marker}` } },
    },
  });
  fixtures.children.push(child.id);
  const reservation = await observer.reservation.create({
    data: { classScheduleId: fixtures.oldClassId, childId: child.id, status: "COMPLETED", attendance: "PRESENT" },
  });
  await observer.reservationApplication.create({
    data: {
      classScheduleId: fixtures.oldClassId,
      childName: child.name,
      childBirthDate: new Date("2012-05-01"),
      childGender: "FEMALE",
      guardianName: `보호자_${marker}`,
      guardianPhone,
      guardianRelationship: "MOTHER",
      programTermsAcknowledged: true,
      privacyConsentAgreed: true,
      legalGuardianConfirmed: true,
      refundTermsAcknowledged: true,
      photoShareConsentAgreed: false,
      photoMarketingConsentAgreed: false,
      consentVersion: "e2e",
      submittedAt: new Date(Date.now() - 3651 * DAY),
      depositConfirmedAt: new Date(Date.now() - 3651 * DAY),
      depositConfirmedById: fixtures.adminUserId,
      status: "CONFIRMED",
      resolvedAt: new Date(Date.now() - 3651 * DAY),
      resolvedById: fixtures.adminUserId,
      childId: child.id,
      reservationId: reservation.id,
    },
  });
  await observer.childConsent.create({
    data: { childId: child.id, consentType: "PRIVACY", action: "AGREED", recordedById: fixtures.adminUserId },
  });
  return child;
}

function purgeInput() {
  return { actorUserId: fixtures.adminUserId, now: new Date() };
}

function reservationInput(childId: string) {
  return { classScheduleId: fixtures.futureClassId, childId };
}

async function childState(childId: string) {
  const [child, futureReservations, consents, safety] = await Promise.all([
    observer.child.findUniqueOrThrow({ where: { id: childId }, select: { personalDataPurgedAt: true, name: true } }),
    observer.reservation.count({
      where: {
        childId,
        status: "RESERVED",
        classSchedule: { status: "SCHEDULED", endsAt: { gte: new Date() } },
      },
    }),
    observer.childConsent.count({ where: { childId } }),
    observer.childSafetyInfo.count({ where: { childId } }),
  ]);
  return { purged: child.personalDataPurgedAt !== null, name: child.name, futureReservations, consents, safety };
}

/** 금지 상태가 없는지 확인한다. 이 spec 이 만든 아이만 본다. */
async function expectNoForbiddenState() {
  const now = new Date();
  expect(
    await observer.reservation.count({
      where: {
        childId: { in: fixtures.children },
        child: { personalDataPurgedAt: { not: null } },
        status: "RESERVED",
        classSchedule: { status: "SCHEDULED", endsAt: { gte: now } },
      },
    }),
  ).toBe(0);
  const purged = await observer.child.findMany({
    where: { id: { in: fixtures.children }, personalDataPurgedAt: { not: null } },
    select: { id: true },
  });
  const purgedIds = purged.map((child) => child.id);
  expect(await observer.childConsent.count({ where: { childId: { in: purgedIds } } })).toBe(0);
  expect(await observer.childSafetyInfo.count({ where: { childId: { in: purgedIds } } })).toBe(0);
}

test.describe.serial("Phase 18 개인정보 파기 동시성 (실제 DB 행 잠금)", () => {
  test.beforeAll(async () => {
    const admin = await observer.user.findUniqueOrThrow({ where: { email: adminEmail }, select: { id: true } });
    fixtures.adminUserId = admin.id;
    const program = await observer.program.create({ data: { name: `동시성프로그램_${marker}`, defaultPrice: 30_000 } });
    fixtures.programId = program.id;
    const now = Date.now();
    const [oldClass, futureClass] = await Promise.all([
      observer.classSchedule.create({
        data: {
          programId: program.id,
          startsAt: new Date(now - 3650 * DAY),
          endsAt: new Date(now - 3650 * DAY + 2 * 60 * 60 * 1000),
          location: `과거장소_${marker}`,
          capacity: 50,
          status: "SCHEDULED",
        },
      }),
      observer.classSchedule.create({
        data: {
          programId: program.id,
          startsAt: new Date(now + 7 * DAY),
          endsAt: new Date(now + 7 * DAY + 2 * 60 * 60 * 1000),
          location: `미래장소_${marker}`,
          capacity: 50,
          status: "SCHEDULED",
        },
      }),
    ]);
    fixtures.oldClassId = oldClass.id;
    fixtures.futureClassId = futureClass.id;
  });

  test.afterAll(async () => {
    const classIds = [fixtures.oldClassId, fixtures.futureClassId].filter(Boolean);
    await observer.childConsent.deleteMany({ where: { childId: { in: fixtures.children } } });
    await observer.reservationApplication.deleteMany({ where: { classScheduleId: { in: classIds } } });
    await observer.reservation.deleteMany({ where: { classScheduleId: { in: classIds } } });
    await observer.classSchedule.deleteMany({ where: { id: { in: classIds } } });
    await observer.child.deleteMany({ where: { id: { in: fixtures.children } } });
    if (fixtures.programId) await observer.program.deleteMany({ where: { id: fixtures.programId } });
    expect(await observer.child.count({ where: { id: { in: fixtures.children } } })).toBe(0);
    await Promise.all([observer.$disconnect(), clientA.$disconnect(), clientB.$disconnect()]);
  });

  test("예약 트랜잭션이 먼저 잠그면 파기는 기다린 뒤 새 미래 예약을 보고 그 아이를 파기하지 않는다", async () => {
    test.setTimeout(90_000);
    const child = await createExpiredCustomer("예약먼저");
    const reserved = deferred();
    const release = deferred();

    const reservation = clientA.$transaction(async (tx) => {
      const created = await createReservationInTransaction(tx, reservationInput(child.id));
      reserved.resolve();
      await release.promise;
      return created;
    }, GATED_TRANSACTION);
    await reserved.promise;

    const purge = purgeExpiredPersonalDataCore(clientB, purgeInput());
    await waitForLockWaiter();
    release.resolve();

    await expect(reservation).resolves.toMatchObject({ id: expect.any(String) });
    await purge;
    expect(await childState(child.id)).toMatchObject({ purged: false, futureReservations: 1, consents: 1, safety: 1 });
    await expectNoForbiddenState();
  });

  test("파기 트랜잭션이 먼저 잠그면 예약은 기다린 뒤 파기된 아이로 거절된다", async () => {
    test.setTimeout(90_000);
    const child = await createExpiredCustomer("파기먼저예약");
    const purged = deferred<PersonalDataPurgeResult>();
    const release = deferred();

    const purge = clientA.$transaction(async (tx) => {
      const result = await purgeExpiredPersonalDataInTransaction(tx, purgeInput());
      purged.resolve(result);
      await release.promise;
      return result;
    }, GATED_TRANSACTION);
    expect((await purged.promise).purgedChildCount).toBeGreaterThanOrEqual(1);

    const reservation = createReservationCore(clientB, reservationInput(child.id)).then(
      () => null,
      (error: unknown) => error,
    );
    await waitForLockWaiter();
    release.resolve();
    await purge;

    expect(await reservation).toMatchObject({ name: "ChildPersonalDataPurgedError" });
    expect(await childState(child.id)).toMatchObject({
      purged: true,
      name: "(파기됨)",
      futureReservations: 0,
      consents: 0,
      safety: 0,
    });
    await expectNoForbiddenState();
  });

  test("동의 기록이 먼저 잠그면 파기는 기다린 뒤 그 동의까지 삭제한다", async () => {
    test.setTimeout(90_000);
    const child = await createExpiredCustomer("동의먼저");
    const wrote = deferred();
    const release = deferred();

    const consent = clientA.$transaction(async (tx) => {
      await recordChildConsentInTransaction(tx, {
        childId: child.id,
        consent: { consentType: "PHOTO_SHARE", action: "AGREED" },
        actorUserId: fixtures.adminUserId,
      });
      wrote.resolve();
      await release.promise;
    }, GATED_TRANSACTION);
    await wrote.promise;

    const purge = purgeExpiredPersonalDataCore(clientB, purgeInput());
    await waitForLockWaiter();
    release.resolve();
    await consent;
    await purge;

    expect(await childState(child.id)).toMatchObject({ purged: true, consents: 0, safety: 0 });
    await expectNoForbiddenState();
  });

  test("파기가 먼저 잠그면 동의 기록은 기다린 뒤 파기된 아이로 거절된다", async () => {
    test.setTimeout(90_000);
    const child = await createExpiredCustomer("파기먼저동의");
    const purged = deferred<PersonalDataPurgeResult>();
    const release = deferred();

    const purge = clientA.$transaction(async (tx) => {
      const result = await purgeExpiredPersonalDataInTransaction(tx, purgeInput());
      purged.resolve(result);
      await release.promise;
      return result;
    }, GATED_TRANSACTION);
    await purged.promise;

    const consent = recordChildConsentCore(clientB, {
      childId: child.id,
      consent: { consentType: "PHOTO_MARKETING", action: "AGREED" },
      actorUserId: fixtures.adminUserId,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    await waitForLockWaiter();
    release.resolve();
    await purge;

    expect(await consent).toMatchObject({ name: "ChildPersonalDataPurgedError" });
    expect(await childState(child.id)).toMatchObject({ purged: true, consents: 0 });
    await expectNoForbiddenState();
  });

  test("안전정보 저장이 먼저 잠그면 파기는 기다린 뒤 그 안전정보까지 삭제한다", async () => {
    test.setTimeout(90_000);
    const child = await createExpiredCustomer("안전먼저");
    const wrote = deferred();
    const release = deferred();

    const safety = clientA.$transaction(async (tx) => {
      await upsertChildSafetyInfoInTransaction(tx, {
        childId: child.id,
        safetyInfo: { allergies: `새 알레르기_${marker}`, emergencyContactPhone: "010-0000-5959" },
        actorUserId: fixtures.adminUserId,
      });
      wrote.resolve();
      await release.promise;
    }, GATED_TRANSACTION);
    await wrote.promise;

    const purge = purgeExpiredPersonalDataCore(clientB, purgeInput());
    await waitForLockWaiter();
    release.resolve();
    await safety;
    await purge;

    expect(await childState(child.id)).toMatchObject({ purged: true, safety: 0 });
    await expectNoForbiddenState();
  });

  test("파기가 먼저 잠그면 안전정보 저장은 기다린 뒤 파기된 아이로 거절된다", async () => {
    test.setTimeout(90_000);
    const child = await createExpiredCustomer("파기먼저안전");
    const purged = deferred<PersonalDataPurgeResult>();
    const release = deferred();

    const purge = clientA.$transaction(async (tx) => {
      const result = await purgeExpiredPersonalDataInTransaction(tx, purgeInput());
      purged.resolve(result);
      await release.promise;
      return result;
    }, GATED_TRANSACTION);
    await purged.promise;

    const safety = upsertChildSafetyInfoCore(clientB, {
      childId: child.id,
      safetyInfo: { allergies: `새 알레르기_${marker}` },
      actorUserId: fixtures.adminUserId,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    await waitForLockWaiter();
    release.resolve();
    await purge;

    expect(await safety).toMatchObject({ name: "ChildPersonalDataPurgedError" });
    expect(await childState(child.id)).toMatchObject({ purged: true, safety: 0 });
    await expectNoForbiddenState();
  });

  test("잠금 순서를 강제하지 않고 파기·예약·동의·안전정보를 한꺼번에 실행해도 금지 상태가 생기지 않는다", async () => {
    test.setTimeout(120_000);
    const children: Awaited<ReturnType<typeof createExpiredCustomer>>[] = [];
    for (const label of ["경합1", "경합2", "경합3", "경합4"]) {
      children.push(await createExpiredCustomer(label));
    }

    const writes = children.flatMap((child, index) => {
      const client = index % 2 === 0 ? clientA : clientB;
      return [
        createReservationCore(client, reservationInput(child.id)),
        recordChildConsentCore(client, {
          childId: child.id,
          consent: { consentType: "PHOTO_SHARE", action: "AGREED" },
          actorUserId: fixtures.adminUserId,
        }),
        upsertChildSafetyInfoCore(client, {
          childId: child.id,
          safetyInfo: { allergies: `경합 알레르기_${marker}` },
          actorUserId: fixtures.adminUserId,
        }),
      ];
    });
    const results = await Promise.allSettled([
      purgeExpiredPersonalDataCore(clientA, purgeInput()),
      ...writes,
      purgeExpiredPersonalDataCore(clientB, purgeInput()),
    ]);

    // 쓰기가 실패한다면 파기된 아이라서여야 한다(교착·시간 초과 등 다른 실패는 없어야 한다).
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ name: "ChildPersonalDataPurgedError" });
      }
    }
    for (const child of children) {
      const state = await childState(child.id);
      if (state.purged) {
        expect(state).toMatchObject({ futureReservations: 0, consents: 0, safety: 0 });
      } else {
        // 파기되지 않았다면 미래 예약이 먼저 커밋된 경우뿐이다(재확인이 파기를 건너뛴다).
        expect(state.futureReservations).toBe(1);
      }
    }
    await expectNoForbiddenState();
  });
});
