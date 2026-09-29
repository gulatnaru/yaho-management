import { describe, expect, it, vi } from "vitest";
import {
  addYearsToKstDate,
  computeApplicationRetention,
  computeConfirmedCustomerRetention,
  CONFIRMED_CUSTOMER_RETENTION_YEARS,
  isPurgeableStatus,
  isRetentionExpired,
  UNCONFIRMED_APPLICATION_RETENTION_YEARS,
} from "@/lib/reservation-applications/retention";
import {
  purgeExpiredPersonalDataCore,
  scanApplicationRetention,
  scanChildRetention,
} from "@/server/reservation-applications/retention";

// 2026-10-03 10:00 KST 수업
const CLASS_STARTS_AT = new Date("2026-10-03T01:00:00.000Z");

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

  it("uses the latest valid reservation even if it is earlier than the application class", () => {
    expect(
      computeApplicationRetention({
        status: "CONFIRMED",
        classStartsAt: CLASS_STARTS_AT,
        lastReservedClassAt: new Date("2025-01-01T01:00:00.000Z"),
      }),
    ).toMatchObject({ basisDate: "2025-01-01", retainUntil: "2030-01-01" });
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

  it("never purges pending applications directly", () => {
    expect(isPurgeableStatus("SUBMITTED")).toBe(false);
    expect(isPurgeableStatus("REJECTED")).toBe(true);
    expect(isPurgeableStatus("CANCELLED")).toBe(true);
    expect(isPurgeableStatus("CONFIRMED")).toBe(true);
  });
});

type ApplicationRow = { id: string; status: string; childId: string | null; childName: string | null; startsAt: Date };
type ChildRow = { id: string; name: string; confirmedClassDates: Date[] };

function createClient(options: {
  applications?: ApplicationRow[];
  children?: ChildRow[];
  lastReserved?: Array<{ childId: string; lastReservedClassAt: Date | null }>;
}) {
  const calls: string[] = [];
  const applicationFindMany = vi.fn(async () =>
    (options.applications ?? []).map(({ startsAt, ...rest }) => ({ ...rest, classSchedule: { startsAt } })),
  );
  const childFindMany = vi.fn(async () =>
    (options.children ?? []).map(({ confirmedClassDates, ...rest }) => ({
      ...rest,
      reservationApplications: confirmedClassDates.map((startsAt) => ({ classSchedule: { startsAt } })),
    })),
  );
  const queryRaw = vi.fn(async () => options.lastReserved ?? []);
  const record = (name: string, count = 1) =>
    vi.fn(async (args: { where: Record<string, unknown> }) => {
      calls.push(name);
      const ids = (args.where.id as { in?: string[] } | undefined)?.in;
      return { count: ids ? ids.length : count };
    });
  const tx = {
    $queryRaw: queryRaw,
    reservationApplication: { findMany: applicationFindMany, updateMany: record("application.update") },
    child: { findMany: childFindMany, updateMany: record("child.update") },
    childConsent: { deleteMany: record("consent.delete") },
    childSafetyInfo: { deleteMany: record("safety.delete") },
    relationship: { deleteMany: record("relationship.delete") },
    reservation: { updateMany: record("reservation.update") },
  };
  const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
  return { client: { ...tx, $transaction: transaction } as never, tx, calls, childFindMany };
}

describe("application retention scan", () => {
  const NOW = new Date("2027-10-10T00:00:00.000Z");
  const OLD_CLASS = new Date("2026-10-03T01:00:00.000Z"); // 미확정 만료일 2027-10-03
  const RECENT_CLASS = new Date("2027-09-01T01:00:00.000Z");

  const applications: ApplicationRow[] = [
    { id: "rejected-old", status: "REJECTED", childId: null, childName: "반려아이", startsAt: OLD_CLASS },
    { id: "cancelled-recent", status: "CANCELLED", childId: null, childName: "최근아이", startsAt: RECENT_CLASS },
    { id: "pending-old", status: "SUBMITTED", childId: null, childName: "대기아이", startsAt: OLD_CLASS },
    { id: "confirmed-old", status: "CONFIRMED", childId: "child-1", childName: "확정아이", startsAt: OLD_CLASS },
  ];

  it("separates purgeable applications from expired pending ones and keeps confirmed ones 5 years", async () => {
    const { client } = createClient({
      applications,
      lastReserved: [{ childId: "child-1", lastReservedClassAt: new Date("2027-06-01T01:00:00.000Z") }],
    });

    const scan = await scanApplicationRetention(client, NOW);

    expect(scan.purgeable.map((candidate) => candidate.id)).toEqual(["rejected-old"]);
    expect(scan.expiredPending.map((candidate) => candidate.id)).toEqual(["pending-old"]);
  });

  it("still keeps a confirmed application after 3 years and expires it after 5", async () => {
    const lastReserved = [{ childId: "child-1", lastReservedClassAt: new Date("2024-06-01T01:00:00.000Z") }];
    const threeYearsLater = await scanApplicationRetention(
      createClient({ applications, lastReserved }).client,
      new Date("2027-06-10T00:00:00.000Z"),
    );
    expect(threeYearsLater.purgeable.map((candidate) => candidate.id)).not.toContain("confirmed-old");

    const fiveYearsLater = await scanApplicationRetention(
      createClient({ applications, lastReserved }).client,
      new Date("2029-06-02T00:00:00.000Z"),
    );
    expect(fiveYearsLater.purgeable.map((candidate) => candidate.id)).toContain("confirmed-old");
  });
});

describe("confirmed customer (child) retention scan", () => {
  const children: ChildRow[] = [
    { id: "child-old", name: "오래된아이", confirmedClassDates: [] },
    { id: "child-recent", name: "최근아이", confirmedClassDates: [] },
    { id: "child-fallback", name: "대체기준아이", confirmedClassDates: [new Date("2020-03-01T01:00:00.000Z")] },
    { id: "child-no-basis", name: "기준없는아이", confirmedClassDates: [] },
  ];
  const lastReserved = [
    { childId: "child-old", lastReservedClassAt: new Date("2020-01-10T01:00:00.000Z") },
    { childId: "child-recent", lastReservedClassAt: new Date("2024-01-10T01:00:00.000Z") },
  ];

  it("targets only unpurged children with reservations or confirmed applications", async () => {
    const { client, childFindMany } = createClient({ children, lastReserved });

    await scanChildRetention(client, new Date("2026-01-01T00:00:00.000Z"));

    expect(childFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          personalDataPurgedAt: null,
          OR: [{ reservations: { some: {} } }, { reservationApplications: { some: { status: "CONFIRMED" } } }],
        },
      }),
    );
  });

  it("expires children five years after the last reserved class, using the confirmed application only as fallback", async () => {
    const { client } = createClient({ children, lastReserved });

    const candidates = await scanChildRetention(client, new Date("2026-01-01T00:00:00.000Z"));

    expect(candidates.map((candidate) => [candidate.id, candidate.retention.retainUntil])).toEqual([
      ["child-old", "2025-01-10"],
      ["child-fallback", "2025-03-01"],
    ]);
  });
});

describe("purgeExpiredPersonalDataCore", () => {
  const NOW = new Date("2026-01-01T00:00:00.000Z");
  const actor = { actorUserId: "admin-1", now: NOW };

  it("anonymizes expired children in place and deletes only consent, safety and relationship rows", async () => {
    const { client, tx, calls } = createClient({
      children: [{ id: "child-old", name: "오래된아이", confirmedClassDates: [] }],
      lastReserved: [{ childId: "child-old", lastReservedClassAt: new Date("2020-01-10T01:00:00.000Z") }],
    });

    await expect(purgeExpiredPersonalDataCore(client, actor)).resolves.toEqual({
      purgedApplicationCount: 1,
      purgedChildCount: 1,
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

  it("purges expired application copies with the admin and time recorded", async () => {
    const { client, tx } = createClient({
      applications: [
        { id: "rejected-old", status: "REJECTED", childId: null, childName: "반려아이", startsAt: new Date("2024-10-03T01:00:00.000Z") },
      ],
    });

    await expect(purgeExpiredPersonalDataCore(client, actor)).resolves.toEqual({
      purgedApplicationCount: 1,
      purgedChildCount: 0,
    });
    expect(tx.reservationApplication.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["rejected-old"] }, personalDataPurgedAt: null, status: { not: "SUBMITTED" } },
      data: {
        childName: null,
        childBirthDate: null,
        childGender: null,
        guardianName: null,
        guardianPhone: null,
        guardianRelationship: null,
        requestNote: null,
        personalDataPurgedAt: NOW,
        personalDataPurgedById: "admin-1",
      },
    });
    expect(tx.childConsent.deleteMany).not.toHaveBeenCalled();
  });

  it("does nothing when nothing has expired", async () => {
    const { client, calls } = createClient({
      children: [{ id: "child-recent", name: "최근아이", confirmedClassDates: [] }],
      lastReserved: [{ childId: "child-recent", lastReservedClassAt: new Date("2025-06-01T01:00:00.000Z") }],
    });

    await expect(purgeExpiredPersonalDataCore(client, actor)).resolves.toEqual({
      purgedApplicationCount: 0,
      purgedChildCount: 0,
    });
    expect(calls).toEqual([]);
  });
});
