import { describe, expect, it, vi } from "vitest";
import {
  addYearsToKstDate,
  computeApplicationRetention,
  isPurgeableStatus,
  isRetentionExpired,
} from "@/lib/reservation-applications/retention";
import {
  purgeExpiredApplicationsCore,
  scanApplicationRetention,
} from "@/server/reservation-applications/retention";

// 2026-10-03 10:00 KST 수업
const CLASS_STARTS_AT = new Date("2026-10-03T01:00:00.000Z");

describe("addYearsToKstDate", () => {
  it("keeps the calendar day and clamps leap days", () => {
    expect(addYearsToKstDate("2026-10-03", 1)).toBe("2027-10-03");
    expect(addYearsToKstDate("2028-02-29", 1)).toBe("2029-02-28");
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

  it("keeps confirmed applications for three years from the child's last reserved class date", () => {
    expect(
      computeApplicationRetention({
        status: "CONFIRMED",
        classStartsAt: CLASS_STARTS_AT,
        lastReservedClassAt: new Date("2027-05-01T01:00:00.000Z"),
      }),
    ).toEqual({ basis: "LAST_RESERVED_CLASS_DATE", basisDate: "2027-05-01", retainUntil: "2030-05-01" });
  });

  it("uses the latest valid reservation even if it is earlier than the application class", () => {
    expect(
      computeApplicationRetention({
        status: "CONFIRMED",
        classStartsAt: CLASS_STARTS_AT,
        lastReservedClassAt: new Date("2025-01-01T01:00:00.000Z"),
      }),
    ).toMatchObject({ basisDate: "2025-01-01", retainUntil: "2028-01-01" });
  });

  it("falls back to the application class date only when there is no valid reservation", () => {
    expect(
      computeApplicationRetention({ status: "CONFIRMED", classStartsAt: CLASS_STARTS_AT, lastReservedClassAt: null }),
    ).toMatchObject({ basis: "LAST_RESERVED_CLASS_DATE", basisDate: "2026-10-03", retainUntil: "2029-10-03" });
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

function createClient(options: {
  applications: Array<{ id: string; status: string; childId: string | null; childName: string | null; startsAt: Date }>;
  lastUse?: Array<{ childId: string; lastReservedClassAt: Date | null }>;
}) {
  const findMany = vi.fn(async () =>
    options.applications.map(({ startsAt, ...rest }) => ({ ...rest, classSchedule: { startsAt } })),
  );
  const queryRaw = vi.fn(async () => options.lastUse ?? []);
  const updateMany = vi.fn(async (args: { where: { id: { in: string[] } } }) => ({ count: args.where.id.in.length }));
  const tx = { reservationApplication: { findMany, updateMany }, $queryRaw: queryRaw };
  const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
  return { client: { ...tx, $transaction: transaction } as never, findMany, queryRaw, updateMany };
}

describe("application retention scan and purge", () => {
  const NOW = new Date("2027-10-10T00:00:00.000Z");
  const OLD_CLASS = new Date("2026-10-03T01:00:00.000Z"); // 만료일 2027-10-03
  const RECENT_CLASS = new Date("2027-09-01T01:00:00.000Z");

  const applications = [
    { id: "rejected-old", status: "REJECTED", childId: null, childName: "반려아이", startsAt: OLD_CLASS },
    { id: "cancelled-recent", status: "CANCELLED", childId: null, childName: "최근아이", startsAt: RECENT_CLASS },
    { id: "pending-old", status: "SUBMITTED", childId: null, childName: "대기아이", startsAt: OLD_CLASS },
    { id: "confirmed-old", status: "CONFIRMED", childId: "child-1", childName: "확정아이", startsAt: OLD_CLASS },
  ];

  it("separates purgeable applications from expired pending ones and uses the last reserved class date for confirmed", async () => {
    const { client, findMany, queryRaw } = createClient({
      applications,
      lastUse: [{ childId: "child-1", lastReservedClassAt: new Date("2027-06-01T01:00:00.000Z") }],
    });

    const scan = await scanApplicationRetention(client, NOW);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { personalDataPurgedAt: null } }));
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(scan.purgeable.map((candidate) => candidate.id)).toEqual(["rejected-old"]);
    expect(scan.expiredPending.map((candidate) => candidate.id)).toEqual(["pending-old"]);
  });

  it("purges confirmed applications once the child's last reserved class date is over three years ago", async () => {
    const { client } = createClient({
      applications,
      lastUse: [{ childId: "child-1", lastReservedClassAt: new Date("2024-06-01T01:00:00.000Z") }],
    });

    const scan = await scanApplicationRetention(client, new Date("2030-01-01T00:00:00.000Z"));

    expect(scan.purgeable.map((candidate) => candidate.id).sort()).toEqual(
      ["cancelled-recent", "confirmed-old", "rejected-old"].sort(),
    );
  });

  it("nulls personal fields only for expired, non-pending, not-yet-purged applications", async () => {
    const { client, updateMany } = createClient({ applications });

    await expect(purgeExpiredApplicationsCore(client, { actorUserId: "admin-1", now: NOW })).resolves.toEqual({
      purgedCount: 1,
    });

    expect(updateMany).toHaveBeenCalledWith({
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
  });

  it("does nothing when no application has expired", async () => {
    const { client, updateMany } = createClient({ applications: [applications[1]] });

    await expect(purgeExpiredApplicationsCore(client, { actorUserId: "admin-1", now: NOW })).resolves.toEqual({
      purgedCount: 0,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
