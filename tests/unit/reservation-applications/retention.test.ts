import { describe, expect, it, vi } from "vitest";
import {
  addYearsToKstDate,
  computeApplicationRetention,
  computeConfirmedCustomerRetention,
  CONFIRMED_CUSTOMER_CANDIDATE_MIN_AGE_DAYS,
  CONFIRMED_CUSTOMER_RETENTION_YEARS,
  isPurgeableStatus,
  isRetentionExpired,
  retentionCandidateCutoff,
  UNCONFIRMED_APPLICATION_CANDIDATE_MIN_AGE_DAYS,
  UNCONFIRMED_APPLICATION_RETENTION_YEARS,
} from "@/lib/reservation-applications/retention";
import { VALID_RESERVATION_CONDITION } from "@/lib/reservation-applications/last-reserved-class";
import {
  CHILD_PURGE_BATCH_SIZE,
  PERSONAL_DATA_PURGE_TRANSACTION_OPTIONS,
  purgeExpiredPersonalDataCore,
  scanApplicationRetention,
  scanChildRetention,
} from "@/server/reservation-applications/retention";

// 2026-10-03 10:00 KST 수업
const CLASS_STARTS_AT = new Date("2026-10-03T01:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("retention periods", () => {
  it("keeps unconfirmed applications 1 year and confirmed customers 5 years", () => {
    expect(UNCONFIRMED_APPLICATION_RETENTION_YEARS).toBe(1);
    expect(CONFIRMED_CUSTOMER_RETENTION_YEARS).toBe(5);
  });
});

describe("addYearsToKstDate", () => {
  it("keeps the calendar day and clamps leap days", () => {
    expect(addYearsToKstDate("2026-10-03", 1)).toBe("2027-10-03");
    expect(addYearsToKstDate("2028-02-29", 5)).toBe("2033-02-28");
    expect(addYearsToKstDate("2028-02-29", 4)).toBe("2032-02-29");
  });
});

describe("computeApplicationRetention", () => {
  it.each(["SUBMITTED", "REJECTED", "CANCELLED"] as const)(
    "keeps %s applications for one year from the class date (KST)",
    (status) => {
      expect(computeApplicationRetention({ status, classStartsAt: CLASS_STARTS_AT, lastReservedClassAt: null })).toEqual({
        basis: "CLASS_DATE",
        basisDate: "2026-10-03",
        retainUntil: "2027-10-03",
      });
    },
  );

  it("uses the KST calendar date for late-evening UTC times", () => {
    // 2026-10-03 23:30 UTC = 2026-10-04 08:30 KST
    const retention = computeApplicationRetention({
      status: "REJECTED",
      classStartsAt: new Date("2026-10-03T23:30:00.000Z"),
      lastReservedClassAt: null,
    });
    expect(retention.basisDate).toBe("2026-10-04");
  });

  it("keeps confirmed applications for five years from the child's last reserved class date", () => {
    expect(
      computeApplicationRetention({
        status: "CONFIRMED",
        classStartsAt: CLASS_STARTS_AT,
        lastReservedClassAt: new Date("2027-05-01T01:00:00.000Z"),
      }),
    ).toEqual({ basis: "LAST_RESERVED_CLASS_DATE", basisDate: "2027-05-01", retainUntil: "2032-05-01" });
  });

  it("falls back to the application class date only when there is no valid reservation", () => {
    expect(
      computeApplicationRetention({ status: "CONFIRMED", classStartsAt: CLASS_STARTS_AT, lastReservedClassAt: null }),
    ).toMatchObject({ basis: "LAST_RESERVED_CLASS_DATE", basisDate: "2026-10-03", retainUntil: "2031-10-03" });
  });
});

describe("computeConfirmedCustomerRetention", () => {
  it("prefers the last reserved class date, then the confirmed application class, else no basis", () => {
    expect(
      computeConfirmedCustomerRetention({
        lastReservedClassAt: new Date("2027-05-01T01:00:00.000Z"),
        fallbackClassAt: CLASS_STARTS_AT,
      }),
    ).toMatchObject({ basisDate: "2027-05-01", retainUntil: "2032-05-01" });
    expect(
      computeConfirmedCustomerRetention({ lastReservedClassAt: null, fallbackClassAt: CLASS_STARTS_AT }),
    ).toMatchObject({ basisDate: "2026-10-03", retainUntil: "2031-10-03" });
    expect(computeConfirmedCustomerRetention({ lastReservedClassAt: null, fallbackClassAt: null })).toBeNull();
  });
});

describe("retention expiry", () => {
  it("keeps data through the last retention day and expires the next KST day", () => {
    const retention = { retainUntil: "2027-10-03" };
    expect(isRetentionExpired(retention, new Date("2027-10-03T14:59:59.000Z"))).toBe(false); // 23:59 KST
    expect(isRetentionExpired(retention, new Date("2027-10-03T15:00:00.000Z"))).toBe(true); // 다음 날 00:00 KST
  });

  it("purges applications on their own only after rejection or cancellation (ADR-058)", () => {
    expect(isPurgeableStatus("SUBMITTED")).toBe(false);
    expect(isPurgeableStatus("REJECTED")).toBe(true);
    expect(isPurgeableStatus("CANCELLED")).toBe(true);
    // 확정 신청은 확정 고객(아이)과 함께 파기한다.
    expect(isPurgeableStatus("CONFIRMED")).toBe(false);
  });
});

/** 보관 만료일 다음 날 00:00 KST — 처음으로 만료로 판정되는 시각 */
function firstExpiredInstant(retainUntil: string): Date {
  return new Date(new Date(`${retainUntil}T00:00:00+09:00`).getTime() + DAY);
}

describe("DB candidate cutoff (RET-PERF) never misses an expired record", () => {
  // 윤년·윤일·연말·KST 자정 직전/직후를 포함한 기준 시각
  const bases = [
    "2028-02-29T14:59:59.999Z", // 2028-02-29 23:59 KST (윤일)
    "2028-02-28T15:00:00.000Z", // 2028-02-29 00:00 KST
    "2027-02-28T14:59:00.000Z",
    "2027-03-01T00:00:00.000Z",
    "2026-12-31T14:59:59.000Z",
    "2026-12-31T15:00:00.000Z",
    "2099-02-28T15:00:00.000Z",
    "2100-02-28T15:00:00.000Z", // 2100 은 평년
    "2026-10-03T01:00:00.000Z",
  ].map((value) => new Date(value));

  it.each([
    ["unconfirmed applications", UNCONFIRMED_APPLICATION_RETENTION_YEARS, UNCONFIRMED_APPLICATION_CANDIDATE_MIN_AGE_DAYS],
    ["confirmed customers", CONFIRMED_CUSTOMER_RETENTION_YEARS, CONFIRMED_CUSTOMER_CANDIDATE_MIN_AGE_DAYS],
  ] as const)("keeps every expired %s inside the SQL cutoff", (_label, years, minAgeDays) => {
    for (const basis of bases) {
      const retention = computeConfirmedCustomerRetention({ lastReservedClassAt: basis, fallbackClassAt: null })!;
      const retainUntil = addYearsToKstDate(retention.basisDate, years);
      const expiredAt = firstExpiredInstant(retainUntil);
      expect(isRetentionExpired({ retainUntil }, expiredAt)).toBe(true);
      expect(isRetentionExpired({ retainUntil }, new Date(expiredAt.getTime() - 1))).toBe(false);
      // 처음 만료되는 순간에도 기준 시각이 후보 기준보다 이르다(이후에는 기준이 더 늦어지므로 계속 포함된다).
      expect(basis.getTime()).toBeLessThan(retentionCandidateCutoff(expiredAt, minAgeDays).getTime());
    }
  });
});

describe("valid reservation condition (마지막 예약 수업일)", () => {
  it("excludes cancelled classes and reservations cancelled before class, keeps NO_SHOW and attended cancellations", () => {
    const sql = VALID_RESERVATION_CONDITION.strings.join("?");
    expect(sql).toContain(`c."status" <> 'CANCELLED'::"ClassStatus"`);
    expect(sql).toContain(`r."status" <> 'CANCELLED'::"ReservationStatus" OR r."attendance" IS NOT NULL`);
  });
});

type ApplicationRow = { id: string; status: string; childName: string | null; startsAt: Date };
type FactsRow = {
  id: string;
  name: string;
  lastReservedClassAt: Date | null;
  latestConfirmedClassAt: Date;
  hasUpcomingReservation?: boolean;
};

type RawCall = { sql: string; values: unknown[] };

function toRaw(arg: unknown): RawCall {
  const sql = arg as { strings: readonly string[]; values: unknown[] };
  return { sql: sql.strings.join("?"), values: [...sql.values] };
}

function createClient(options: {
  applications?: ApplicationRow[];
  facts?: FactsRow[];
  /** 잠금 후 다시 읽은 값. 없으면 facts 를 잠근 id 로 거른다. */
  recheck?: FactsRow[];
  /** FOR UPDATE 가 돌려줄 id. 없으면 요청한 id 전부 */
  lockedIds?: string[];
}) {
  const calls: string[] = [];
  const rawCalls: RawCall[] = [];
  const normalize = (row: FactsRow) => ({ hasUpcomingReservation: false, ...row });

  const applicationFindMany = vi.fn(
    async (args: {
      where: { status: { in: string[] }; classSchedule: { startsAt: { lt: Date } } };
      take: number;
    }) =>
      (options.applications ?? [])
        .filter((row) => args.where.status.in.includes(row.status))
        .filter((row) => row.startsAt < args.where.classSchedule.startsAt.lt)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .slice(0, args.take)
        .map(({ startsAt, ...rest }) => ({ ...rest, classSchedule: { startsAt } })),
  );

  const queryRaw = vi.fn(async (arg: unknown) => {
    const raw = toRaw(arg);
    rawCalls.push(raw);
    if (raw.sql.includes("FOR UPDATE")) {
      calls.push("child.lock");
      const requested = raw.values.filter((value): value is string => typeof value === "string");
      return (options.lockedIds ?? requested).map((id) => ({ id }));
    }
    if (raw.sql.includes("WITH confirmed AS")) {
      if (raw.sql.includes(`a."childId" IN`)) {
        calls.push("facts.recheck");
        const ids = raw.values.filter((value): value is string => typeof value === "string");
        return (options.recheck ?? options.facts ?? []).filter((row) => ids.includes(row.id)).map(normalize);
      }
      calls.push("facts.scan");
      const limit = raw.values.find((value): value is number => typeof value === "number");
      return (options.facts ?? []).slice(0, limit ?? undefined).map(normalize);
    }
    throw new Error(`unexpected raw query: ${raw.sql}`);
  });

  const record = (name: string) =>
    vi.fn(async (args: { where: Record<string, unknown> }) => {
      calls.push(name);
      const ids =
        (args.where.id as { in?: string[] } | undefined)?.in ??
        (args.where.childId as { in?: string[] } | undefined)?.in;
      return { count: ids ? ids.length : 0 };
    });
  const tx = {
    $queryRaw: queryRaw,
    reservationApplication: { findMany: applicationFindMany, updateMany: record("application.update") },
    child: { updateMany: record("child.update") },
    childConsent: { deleteMany: record("consent.delete") },
    childSafetyInfo: { deleteMany: record("safety.delete") },
    relationship: { deleteMany: record("relationship.delete") },
    reservation: { updateMany: record("reservation.update") },
  };
  const transaction = vi.fn(async (...args: [callback: (value: typeof tx) => Promise<unknown>, options?: unknown]) =>
    args[0](tx),
  );
  return { client: { ...tx, $transaction: transaction } as never, tx, calls, rawCalls, transaction, applicationFindMany };
}

describe("application retention scan", () => {
  const NOW = new Date("2027-10-10T00:00:00.000Z");
  const OLD_CLASS = new Date("2026-10-03T01:00:00.000Z"); // 미확정 만료일 2027-10-03
  const RECENT_CLASS = new Date("2027-09-01T01:00:00.000Z");

  const applications: ApplicationRow[] = [
    { id: "rejected-old", status: "REJECTED", childName: "반려아이", startsAt: OLD_CLASS },
    { id: "cancelled-recent", status: "CANCELLED", childName: "최근아이", startsAt: RECENT_CLASS },
    { id: "pending-old", status: "SUBMITTED", childName: "대기아이", startsAt: OLD_CLASS },
    { id: "confirmed-old", status: "CONFIRMED", childName: "확정아이", startsAt: OLD_CLASS },
  ];

  it("separates purgeable rejected/cancelled applications from expired pending ones and never lists confirmed ones", async () => {
    const { client, applicationFindMany } = createClient({ applications });

    const scan = await scanApplicationRetention(client, NOW);

    expect(scan.purgeable.map((candidate) => candidate.id)).toEqual(["rejected-old"]);
    expect(scan.expiredPending.map((candidate) => candidate.id)).toEqual(["pending-old"]);
    expect(scan.hasMore).toBe(false);
    const statuses = applicationFindMany.mock.calls.map(([args]) => args.where.status.in);
    expect(statuses).toEqual([["REJECTED", "CANCELLED"], ["SUBMITTED"]]);
  });

  it("narrows candidates in the database by class time before the exact KST check", async () => {
    const { client, applicationFindMany } = createClient({ applications });

    await scanApplicationRetention(client, NOW);

    const [[args]] = applicationFindMany.mock.calls;
    expect(args.where).toMatchObject({ personalDataPurgedAt: null });
    expect(args.where.classSchedule.startsAt.lt).toEqual(
      new Date(NOW.getTime() - UNCONFIRMED_APPLICATION_CANDIDATE_MIN_AGE_DAYS * DAY),
    );
  });

  it("reports hasMore when there are more expired applications than one batch", async () => {
    const many: ApplicationRow[] = Array.from({ length: 4 }, (_, index) => ({
      id: `rejected-${index}`,
      status: "REJECTED",
      childName: `아이${index}`,
      startsAt: new Date(OLD_CLASS.getTime() - index * DAY),
    }));
    const { client, applicationFindMany } = createClient({ applications: many });

    const scan = await scanApplicationRetention(client, NOW, { limit: 3 });

    expect(scan.purgeable).toHaveLength(3);
    expect(scan.hasMore).toBe(true);
    expect(applicationFindMany.mock.calls[0]?.[0].take).toBe(4);
  });
});

describe("confirmed customer (child) retention scan", () => {
  const NOW = new Date("2026-01-01T00:00:00.000Z");
  const facts: FactsRow[] = [
    {
      id: "child-old",
      name: "오래된아이",
      lastReservedClassAt: new Date("2020-01-10T01:00:00.000Z"),
      latestConfirmedClassAt: new Date("2019-06-01T01:00:00.000Z"),
    },
    {
      id: "child-fallback",
      name: "대체기준아이",
      lastReservedClassAt: null,
      latestConfirmedClassAt: new Date("2020-03-01T01:00:00.000Z"),
    },
    {
      // SQL 후보 기준(1824일)은 통과했지만 KST 달력 기준으로는 아직 만료 전
      id: "child-boundary",
      name: "경계아이",
      lastReservedClassAt: new Date("2021-01-01T01:00:00.000Z"),
      latestConfirmedClassAt: new Date("2020-06-01T01:00:00.000Z"),
    },
  ];

  it("reads only unpurged children with a CONFIRMED Phase 18 application (SCOPE-1)", async () => {
    const { client, rawCalls } = createClient({ facts });

    await scanChildRetention(client, NOW);

    const [scan] = rawCalls;
    expect(scan?.sql).toContain(`WHERE a."status" = 'CONFIRMED'::"ReservationApplicationStatus"`);
    expect(scan?.sql).toContain(`FROM confirmed\n    JOIN "Child" ch ON ch."id" = confirmed."childId"`);
    expect(scan?.sql).toContain(`AND ch."personalDataPurgedAt" IS NULL`);
    // 예약만 있는 아이를 대상으로 삼던 조건(예약이 있거나 확정된 신청이 있는 아이)은 없어야 한다.
    expect(scan?.sql).not.toMatch(/FROM "Child" ch\s+WHERE/);
    expect(scan?.values).toContainEqual(new Date(NOW.getTime() - CONFIRMED_CUSTOMER_CANDIDATE_MIN_AGE_DAYS * DAY));
    expect(scan?.values).toContain(CHILD_PURGE_BATCH_SIZE + 1);
  });

  it("expires children five years after the last reserved class, using the confirmed application only as fallback", async () => {
    const { client } = createClient({ facts });

    const scan = await scanChildRetention(client, NOW);

    expect(scan.candidates.map((candidate) => [candidate.id, candidate.retention.retainUntil])).toEqual([
      ["child-old", "2025-01-10"],
      ["child-fallback", "2025-03-01"],
    ]);
    expect(scan.hasMore).toBe(false);
  });

  it("never proposes a child with an upcoming reservation", async () => {
    const { client } = createClient({ facts: [{ ...facts[0]!, hasUpcomingReservation: true }] });

    const scan = await scanChildRetention(client, NOW);

    expect(scan.candidates).toEqual([]);
  });

  it("reports hasMore when more candidates than one batch exist", async () => {
    const { client } = createClient({ facts });

    const scan = await scanChildRetention(client, NOW, { limit: 1 });

    expect(scan.candidates.map((candidate) => candidate.id)).toEqual(["child-old"]);
    expect(scan.hasMore).toBe(true);
  });
});

describe("purgeExpiredPersonalDataCore", () => {
  const NOW = new Date("2026-01-01T00:00:00.000Z");
  const actor = { actorUserId: "admin-1", now: NOW };
  const expired: FactsRow = {
    id: "child-old",
    name: "오래된아이",
    lastReservedClassAt: new Date("2020-01-10T01:00:00.000Z"),
    latestConfirmedClassAt: new Date("2019-06-01T01:00:00.000Z"),
  };

  it("runs in one transaction with a bounded timeout", async () => {
    const { client, transaction } = createClient({});

    await purgeExpiredPersonalDataCore(client, actor);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0]?.[1]).toEqual(PERSONAL_DATA_PURGE_TRANSACTION_OPTIONS);
    expect(PERSONAL_DATA_PURGE_TRANSACTION_OPTIONS.timeout).toBeGreaterThan(0);
  });

  it("locks candidates FOR UPDATE in id order and re-reads the facts before writing (CONC-1)", async () => {
    const { client, calls, rawCalls } = createClient({
      facts: [
        { ...expired, id: "child-b" },
        { ...expired, id: "child-a" },
      ],
    });

    await purgeExpiredPersonalDataCore(client, actor);

    const lock = rawCalls.find((call) => call.sql.includes("FOR UPDATE"));
    expect(lock?.sql).toMatch(/"personalDataPurgedAt" IS NULL\s+ORDER BY "id"\s+FOR UPDATE/);
    expect(lock?.values.filter((value) => typeof value === "string")).toEqual(["child-a", "child-b"]);
    expect(calls.indexOf("child.lock")).toBeGreaterThan(calls.indexOf("facts.scan"));
    expect(calls.indexOf("facts.recheck")).toBeGreaterThan(calls.indexOf("child.lock"));
    expect(calls.indexOf("consent.delete")).toBeGreaterThan(calls.indexOf("facts.recheck"));
  });

  it("does not purge a child whose re-read shows a new future reservation made before the lock", async () => {
    const { client, tx, calls } = createClient({
      facts: [expired],
      recheck: [
        {
          ...expired,
          lastReservedClassAt: new Date("2026-02-01T01:00:00.000Z"),
          hasUpcomingReservation: true,
        },
      ],
    });

    await expect(purgeExpiredPersonalDataCore(client, actor)).resolves.toEqual({
      purgedApplicationCount: 0,
      purgedChildCount: 0,
      hasMore: false,
    });
    expect(calls).toEqual(["facts.scan", "child.lock", "facts.recheck"]);
    expect(tx.child.updateMany).not.toHaveBeenCalled();
    expect(tx.childConsent.deleteMany).not.toHaveBeenCalled();
  });

  it("skips children another purge already processed while this one waited for the lock", async () => {
    const { client, calls } = createClient({ facts: [expired], lockedIds: [] });

    await expect(purgeExpiredPersonalDataCore(client, actor)).resolves.toMatchObject({ purgedChildCount: 0 });
    expect(calls).toEqual(["facts.scan", "child.lock"]);
  });

  it("anonymizes expired children in place and deletes only consent, safety and relationship rows", async () => {
    const { client, tx, calls } = createClient({ facts: [expired] });

    await expect(purgeExpiredPersonalDataCore(client, actor)).resolves.toEqual({
      purgedApplicationCount: 1,
      purgedChildCount: 1,
      hasMore: false,
    });

    const childIds = { in: ["child-old"] };
    expect(tx.childConsent.deleteMany).toHaveBeenCalledWith({ where: { childId: childIds } });
    expect(tx.childSafetyInfo.deleteMany).toHaveBeenCalledWith({ where: { childId: childIds } });
    expect(tx.relationship.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ childAId: childIds }, { childBId: childIds }] },
    });
    expect(tx.reservation.updateMany).toHaveBeenCalledWith({
      where: { childId: childIds },
      data: { memo: null, cancelDetail: null },
    });
    expect(tx.reservationApplication.updateMany).toHaveBeenCalledWith({
      where: { childId: childIds, personalDataPurgedAt: null, status: "CONFIRMED" },
      data: expect.objectContaining({ childName: null, resolutionNote: null, personalDataPurgedAt: NOW }),
    });
    expect(tx.child.updateMany).toHaveBeenCalledWith({
      where: { id: childIds, personalDataPurgedAt: null },
      data: {
        name: "(파기됨)",
        birthDate: null,
        gender: "UNSPECIFIED",
        guardianName: null,
        guardianPhone: null,
        memo: null,
        isActive: false,
        personalDataPurgedAt: NOW,
        personalDataPurgedById: "admin-1",
      },
    });
    // Child·예약·결제·환불 행은 삭제하지 않는다.
    expect(calls).not.toContain("child.delete");
    expect(Object.keys(tx)).not.toContain("payment");
    expect(Object.keys(tx)).not.toContain("refund");
  });

  it("purges expired rejected applications including the free-text reason (PURGE-2)", async () => {
    const { client, tx } = createClient({
      applications: [
        { id: "rejected-old", status: "REJECTED", childName: "반려아이", startsAt: new Date("2024-10-03T01:00:00.000Z") },
        { id: "confirmed-old", status: "CONFIRMED", childName: "확정아이", startsAt: new Date("2019-10-03T01:00:00.000Z") },
      ],
    });

    await expect(purgeExpiredPersonalDataCore(client, actor)).resolves.toEqual({
      purgedApplicationCount: 1,
      purgedChildCount: 0,
      hasMore: false,
    });
    expect(tx.reservationApplication.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.reservationApplication.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["rejected-old"] },
        personalDataPurgedAt: null,
        status: { in: ["REJECTED", "CANCELLED"] },
      },
      data: {
        childName: null,
        childBirthDate: null,
        childGender: null,
        guardianName: null,
        guardianPhone: null,
        guardianRelationship: null,
        requestNote: null,
        resolutionNote: null,
        personalDataPurgedAt: NOW,
        personalDataPurgedById: "admin-1",
      },
    });
    expect(tx.childConsent.deleteMany).not.toHaveBeenCalled();
  });

  it("does nothing when nothing has expired", async () => {
    const { client, calls } = createClient({
      facts: [
        {
          id: "child-recent",
          name: "최근아이",
          lastReservedClassAt: new Date("2025-06-01T01:00:00.000Z"),
          latestConfirmedClassAt: new Date("2025-06-01T01:00:00.000Z"),
        },
      ],
    });

    await expect(purgeExpiredPersonalDataCore(client, actor)).resolves.toEqual({
      purgedApplicationCount: 0,
      purgedChildCount: 0,
      hasMore: false,
    });
    expect(calls).toEqual(["facts.scan"]);
  });
});
