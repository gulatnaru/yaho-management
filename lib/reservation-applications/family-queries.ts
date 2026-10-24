import { Prisma } from "@prisma/client";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { APPLICATION_LIST_PAGE_SIZE } from "./list";
import { parseFamilyFilters, type ApplicationSearchParams, type FamilyFilters } from "./navigation";
import { listDepositSummary, summarizeLedger, type LedgerTotals } from "./ledger-summary";

export const FAMILY_CHILD_SELECT = {
  id: true, submissionId: true, childName: true, guardianName: true, status: true, quotedAmount: true,
  depositConfirmedAt: true, classScheduleId: true,
  classSchedule: { select: { startsAt: true, endsAt: true, program: { select: { name: true } } } },
} as const satisfies Prisma.ReservationApplicationSelect;
export type FamilyChild = Omit<Prisma.ReservationApplicationGetPayload<{ select: typeof FAMILY_CHILD_SELECT }>, "guardianName" | "submissionId"> & { matchesFilter: boolean; isPossibleDuplicate: boolean };
export type FamilyApplication = {
  kind: "submission" | "legacy"; id: string; guardianName: string | null; children: FamilyChild[];
  notificationReceived: boolean | null; legacyDepositConfirmed: boolean | null;
  deposit: ReturnType<typeof listDepositSummary>;
};
export type PendingFamilyCount = { families: number; childApplications: number };
export type FamilyListResult = { families: FamilyApplication[]; totalFamilies: number; totalChildApplications: number; matchingChildApplications: number; totalUnfilteredFamilies: number; page: number; totalPages: number; globalPending: PendingFamilyCount; filters: FamilyFilters };
type Key = { kind: "submission" | "legacy"; id: string };
type Counts = { families: bigint; children: bigint; matching: bigint; unfiltered: bigint; pendingFamilies: bigint; pendingChildren: bigint };

function childPredicate(filters: FamilyFilters) {
  return Prisma.sql`${filters.status === "all" ? Prisma.sql`TRUE` : Prisma.sql`a."status"::text = ${filters.status}`} AND ${filters.classScheduleId ? Prisma.sql`a."classScheduleId" = ${filters.classScheduleId}` : Prisma.sql`TRUE`}`;
}
/** Both filters use a single child alias. No class eligibility predicate hides unresolved requests. */
export function familyKeysSql(filters: FamilyFilters) {
  const notification = filters.notification === "all" ? Prisma.sql`TRUE` : filters.notification === "received" ? Prisma.sql`s."depositNotifiedAt" IS NOT NULL` : filters.notification === "none" ? Prisma.sql`s."depositNotifiedAt" IS NULL` : Prisma.sql`FALSE`;
  const bank = filters.bankRecord === "all" ? Prisma.sql`TRUE` : filters.bankRecord === "legacy" ? Prisma.sql`FALSE` : Prisma.sql`${filters.bankRecord === "recorded" ? Prisma.sql`EXISTS` : Prisma.sql`NOT EXISTS`} (SELECT 1 FROM "ApplicationDeposit" d WHERE d."submissionId" = s.id)`;
  const legacy = ["all", "legacy"].includes(filters.notification) && ["all", "legacy"].includes(filters.bankRecord);
  return Prisma.sql`
    SELECT 'submission'::text AS kind, s.id, s."submittedAt" AS submitted,
      MIN(c."startsAt") AS starts, COUNT(*) AS matching,
      (SELECT COUNT(*) FROM "ReservationApplication" sibling WHERE sibling."submissionId" = s.id) AS children
    FROM "ReservationApplicationSubmission" s
    JOIN "ReservationApplication" a ON a."submissionId" = s.id
    JOIN "ClassSchedule" c ON c.id = a."classScheduleId"
    WHERE ${childPredicate(filters)} AND ${notification} AND ${bank}
    GROUP BY s.id
    UNION ALL
    SELECT 'legacy'::text AS kind, a.id, a."submittedAt" AS submitted, c."startsAt" AS starts, 1::bigint AS matching, 1::bigint AS children
    FROM "ReservationApplication" a JOIN "ClassSchedule" c ON c.id = a."classScheduleId"
    WHERE a."submissionId" IS NULL AND ${childPredicate(filters)} AND ${legacy}`;
}
function pendingSql() {
  return Prisma.sql`SELECT COUNT(*)::bigint AS families, COALESCE(SUM(n), 0)::bigint AS children FROM (
    SELECT "submissionId", COUNT(*) AS n FROM "ReservationApplication" WHERE status = 'SUBMITTED' AND "submissionId" IS NOT NULL GROUP BY "submissionId"
    UNION ALL SELECT id, 1::bigint FROM "ReservationApplication" WHERE status = 'SUBMITTED' AND "submissionId" IS NULL
  ) pending`;
}
export async function countPendingApplicationFamilies(): Promise<PendingFamilyCount> {
  await requireAdminPrincipal();
  const [row] = await prisma.$queryRaw<{ families: bigint; children: bigint }[]>(pendingSql());
  return { families: Number(row?.families ?? 0), childApplications: Number(row?.children ?? 0) };
}

/** Batched comparison projection: only application IDs leave PostgreSQL, never comparison PII. */
export async function findPossibleDuplicateApplicationIds(ids: string[], client: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma): Promise<Set<string>> {
  await requireAdminPrincipal();
  if (!ids.length) return new Set();
  const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT a.id FROM "ReservationApplication" a
      LEFT JOIN "ReservationApplicationSubmission" s ON s.id = a."submissionId"
      WHERE a.id IN (${Prisma.join(ids)}) AND a.status IN ('SUBMITTED', 'CONFIRMED')
        AND a."personalDataPurgedAt" IS NULL AND (s.id IS NULL OR s."personalDataPurgedAt" IS NULL)
        AND a."childName" IS NOT NULL AND COALESCE(a."guardianPhone", s."guardianPhone") IS NOT NULL
        AND EXISTS (SELECT 1 FROM "ReservationApplication" other
          LEFT JOIN "ReservationApplicationSubmission" os ON os.id = other."submissionId"
          WHERE other.id <> a.id AND other."classScheduleId" = a."classScheduleId"
            AND other.status IN ('SUBMITTED', 'CONFIRMED') AND other."personalDataPurgedAt" IS NULL
            AND (os.id IS NULL OR os."personalDataPurgedAt" IS NULL)
            AND LOWER(btrim(regexp_replace(other."childName", '[[:space:]]+', ' ', 'g'))) = LOWER(btrim(regexp_replace(a."childName", '[[:space:]]+', ' ', 'g')))
            AND regexp_replace(COALESCE(other."guardianPhone", os."guardianPhone"), '[^0-9]', '', 'g') = regexp_replace(COALESCE(a."guardianPhone", s."guardianPhone"), '[^0-9]', '', 'g'))
    `);
  return new Set(rows.map((row) => row.id));
}

// Independent aggregates avoid deposits × allocations × obligations × children multiplication.
async function loadLedgerTotals(tx: Prisma.TransactionClient, ids: string[]) {
  if (!ids.length) return new Map<string, LedgerTotals>();
  const rows = await tx.$queryRaw<Array<{ id: string; quote: bigint | null; deposits: bigint; paymentAllocated: bigint; returnFunded: bigint; returned: bigint; valid: boolean }>>(Prisma.sql`
    WITH quotes AS (
      SELECT "submissionId" AS id, CASE WHEN BOOL_AND("quotedAmount" IS NOT NULL AND "quotedAmount" > 0) THEN SUM("quotedAmount") END AS quote
      FROM "ReservationApplication" WHERE "submissionId" IN (${Prisma.join(ids)}) GROUP BY "submissionId"
    ), deposits AS (
      SELECT d."submissionId" AS id, SUM(d.amount) AS amount,
        BOOL_AND(d.amount > 0 AND COALESCE(a.used, 0) <= d.amount AND COALESCE(a.valid, TRUE)) AS valid,
        COALESCE(SUM(a.payment), 0) AS payment, COALESCE(SUM(a.funded), 0) AS funded
      FROM "ApplicationDeposit" d LEFT JOIN (
        SELECT "depositId", SUM(amount) AS used,
          BOOL_AND(amount > 0 AND (("paymentMappingId" IS NULL) <> ("returnObligationId" IS NULL))) AS valid,
          SUM(CASE WHEN "paymentMappingId" IS NOT NULL THEN amount ELSE 0 END) AS payment,
          SUM(CASE WHEN "returnObligationId" IS NOT NULL THEN amount ELSE 0 END) AS funded
        FROM "FundAllocation" WHERE "depositId" IN (SELECT id FROM "ApplicationDeposit" WHERE "submissionId" IN (${Prisma.join(ids)})) GROUP BY "depositId"
      ) a ON a."depositId" = d.id WHERE d."submissionId" IN (${Prisma.join(ids)}) GROUP BY d."submissionId"
    ), obligations AS (
      SELECT o."submissionId" AS id, SUM(o.amount) AS funded, SUM(o."returnedAmount") AS returned,
        BOOL_AND(o.amount > 0 AND o."returnedAmount" >= 0 AND o."returnedAmount" <= o.amount
          AND o.amount = COALESCE(a.funded, 0) AND o."returnedAmount" = COALESCE(r.returned, 0)) AS valid
      FROM "ReturnObligation" o
      LEFT JOIN (SELECT "returnObligationId" AS id, SUM(amount) AS funded FROM "FundAllocation" WHERE "returnObligationId" IN (SELECT id FROM "ReturnObligation" WHERE "submissionId" IN (${Prisma.join(ids)})) GROUP BY "returnObligationId") a ON a.id = o.id
      LEFT JOIN (SELECT "returnObligationId" AS id, SUM(amount) AS returned FROM "ApplicationReturn" WHERE "returnObligationId" IN (SELECT id FROM "ReturnObligation" WHERE "submissionId" IN (${Prisma.join(ids)})) GROUP BY "returnObligationId") r ON r.id = o.id
      WHERE o."submissionId" IN (${Prisma.join(ids)}) GROUP BY o."submissionId"
    )
    SELECT q.id, q.quote, COALESCE(d.amount, 0)::bigint AS deposits, COALESCE(d.payment, 0)::bigint AS "paymentAllocated",
      COALESCE(o.funded, 0)::bigint AS "returnFunded", COALESCE(o.returned, 0)::bigint AS returned,
      (COALESCE(d.valid, TRUE) AND COALESCE(o.valid, TRUE) AND COALESCE(d.funded, 0) = COALESCE(o.funded, 0)) AS valid
    FROM quotes q LEFT JOIN deposits d ON d.id = q.id LEFT JOIN obligations o ON o.id = q.id`);
  return new Map(rows.map((r) => [r.id, { quote: r.quote === null ? null : Number(r.quote), deposits: Number(r.deposits), paymentAllocated: Number(r.paymentAllocated), returnFunded: Number(r.returnFunded), returned: Number(r.returned), valid: r.valid }]));
}

export async function listApplicationFamilies(input: ApplicationSearchParams = {}): Promise<FamilyListResult> {
  await requireAdminPrincipal();
  const filters = parseFamilyFilters(input);
  return prisma.$transaction(async (tx) => {
    const eligible = familyKeysSql(filters);
    const [counts] = await tx.$queryRaw<Counts[]>(Prisma.sql`
      WITH eligible AS (${eligible}), pending AS (${pendingSql()})
      SELECT COUNT(*)::bigint AS families, COALESCE(SUM(children), 0)::bigint AS children, COALESCE(SUM(matching), 0)::bigint AS matching,
        (SELECT COUNT(*) FROM (SELECT DISTINCT "submissionId" FROM "ReservationApplication" WHERE "submissionId" IS NOT NULL UNION ALL SELECT id FROM "ReservationApplication" WHERE "submissionId" IS NULL) all_keys)::bigint AS unfiltered,
        (SELECT families FROM pending) AS "pendingFamilies", (SELECT children FROM pending) AS "pendingChildren" FROM eligible`);
    if (!counts) throw new Error("FAMILY_COUNTS_UNAVAILABLE");
    const totalFamilies = Number(counts.families);
    const totalPages = Math.max(1, Math.ceil(totalFamilies / APPLICATION_LIST_PAGE_SIZE));
    const page = Math.min(filters.page, totalPages);
    const order = filters.status === "SUBMITTED" ? Prisma.sql`starts ASC, submitted ASC, kind ASC, id ASC` : Prisma.sql`submitted DESC, kind ASC, id ASC`;
    const keys = await tx.$queryRaw<Key[]>(Prisma.sql`SELECT kind, id FROM (${eligible}) eligible ORDER BY ${order} LIMIT ${APPLICATION_LIST_PAGE_SIZE} OFFSET ${(page - 1) * APPLICATION_LIST_PAGE_SIZE}`);
    const modernIds = keys.filter((k) => k.kind === "submission").map((k) => k.id);
    const legacyIds = keys.filter((k) => k.kind === "legacy").map((k) => k.id);
    const children = keys.length ? await tx.reservationApplication.findMany({ where: { OR: [{ submissionId: { in: modernIds } }, { id: { in: legacyIds }, submissionId: null }] }, select: FAMILY_CHILD_SELECT, orderBy: [{ submittedAt: "asc" }, { id: "asc" }] }) : [];
    const submissions = modernIds.length ? await tx.reservationApplicationSubmission.findMany({ where: { id: { in: modernIds } }, select: { id: true, guardianName: true, depositNotifiedAt: true } }) : [];
    // A failed financial read never becomes a successful zero. Isolate its SQL error with a savepoint.
    let ledgers = new Map<string, LedgerTotals>();
    if (modernIds.length) {
      await tx.$executeRaw`SAVEPOINT family_ledger_read`;
      try { ledgers = await loadLedgerTotals(tx, modernIds); await tx.$executeRaw`RELEASE SAVEPOINT family_ledger_read`; }
      catch { await tx.$executeRaw`ROLLBACK TO SAVEPOINT family_ledger_read`; await tx.$executeRaw`RELEASE SAVEPOINT family_ledger_read`; }
    }
    const duplicateIds = await findPossibleDuplicateApplicationIds(children.map((child) => child.id), tx);
    const bySubmission = new Map(submissions.map((s) => [s.id, s]));
    const grouped = new Map<string, typeof children>();
    for (const child of children) { const key = child.submissionId ? `submission:${child.submissionId}` : `legacy:${child.id}`; const siblings = grouped.get(key) ?? []; siblings.push(child); grouped.set(key, siblings); }
    const families = keys.map((key): FamilyApplication => {
      const siblings = grouped.get(`${key.kind}:${key.id}`) ?? [];
      const submission = bySubmission.get(key.id);
      return { ...key, guardianName: key.kind === "submission" ? submission?.guardianName ?? null : siblings[0]?.guardianName ?? null,
        notificationReceived: key.kind === "submission" ? Boolean(submission?.depositNotifiedAt) : null,
        legacyDepositConfirmed: key.kind === "legacy" ? Boolean(siblings[0]?.depositConfirmedAt) : null,
        deposit: listDepositSummary(summarizeLedger(key.kind, ledgers.get(key.id))),
        children: siblings.map((child) => ({ id: child.id, childName: child.childName, status: child.status, quotedAmount: child.quotedAmount, depositConfirmedAt: child.depositConfirmedAt, classScheduleId: child.classScheduleId, classSchedule: child.classSchedule, isPossibleDuplicate: duplicateIds.has(child.id), matchesFilter: (filters.status === "all" || child.status === filters.status) && (!filters.classScheduleId || child.classScheduleId === filters.classScheduleId) })),
      };
    });
    return { families, totalFamilies, totalChildApplications: Number(counts.children), matchingChildApplications: Number(counts.matching), totalUnfilteredFamilies: Number(counts.unfiltered), page, totalPages, globalPending: { families: Number(counts.pendingFamilies), childApplications: Number(counts.pendingChildren) }, filters: { ...filters, page } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
