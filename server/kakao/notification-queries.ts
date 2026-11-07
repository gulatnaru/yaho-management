import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { buildDedupeKey } from "@/lib/kakao/notify";

export type NotificationSummary = {
  status: string; attemptCount: number; updatedAt: Date; nextRetryAt: Date | null;
  submittedAt: Date | null; finalStatus: string | null; reconciliationState: string | null; lastErrorCode: string | null;
};

/** Only normalized state leaves the server. Every entry point authorizes before querying. */
export async function getNotificationSummary(submissionId: string): Promise<NotificationSummary | null> {
  await requireAdminPrincipal();
  const id = z.string().min(1).max(128).parse(submissionId);
  const key = buildDedupeKey("application.received", id, "created");
  const rows = await prisma.$queryRaw<NotificationSummary[]>`
    SELECT o."status"::text AS "status", o."attemptCount", GREATEST(o."updatedAt", COALESCE(a."lastAt", o."updatedAt")) AS "updatedAt", o."nextRetryAt",
      s."issuedAt" AS "submittedAt", d."finalStatus", d."reconciliationState", o."lastErrorCode"
    FROM "NotificationOutbox" o LEFT JOIN "NotificationDispatch" d ON d."outboxId" = o."id"
    LEFT JOIN LATERAL (SELECT MIN("issuedAt") AS "issuedAt" FROM "NotificationCostReservation" WHERE "dispatchId" = d."id" AND "entryKind" = 'SEND_SLOT') s ON true
    LEFT JOIN LATERAL (SELECT MAX("occurredAt") AS "lastAt" FROM "NotificationAudit" WHERE ("outboxId" = o."id" OR "dispatchId" = d."id") AND ("toState" IS NOT NULL OR "eventType" IN ('outbox_claimed', 'outbox_recovered', 'outbox_failed', 'outbox_skipped', 'result_unknown', 'result_recorded', 'closed_unconfirmed'))) a ON true
    WHERE o."dedupeKey" = ${key} AND o."eventKind" = 'application.received' AND o."audience" = 'admin'
  `;
  return rows[0] ?? null;
}

export type NotificationHistoryRow = NotificationSummary & { entityId: string; occurredAt: Date; slotCount: number | null; unresolvedSlots: number; unresolvedCosts: number; unknownSince: Date | null; reviewed7dAt: Date | null; responsibilityReviewedAt: Date | null; nextReviewAt: Date | null };

const historyFilter = z.enum(["attention", "all", "failed", "skipped", "unknown"]);
export async function getNotificationHistory(page: number, filter: string = "attention"): Promise<{ rows: NotificationHistoryRow[]; budget: BudgetSnapshot }> {
  await requireAdminPrincipal();
  const safePage = z.number().int().min(1).max(1000).parse(page);
  const safeFilter = historyFilter.parse(filter);
  const [rows, budget] = await Promise.all([prisma.$queryRaw<NotificationHistoryRow[]>`
    SELECT o."entityId", o."occurredAt", o."status"::text AS "status", o."attemptCount", GREATEST(o."updatedAt", COALESCE(a."lastAt", o."updatedAt")) AS "updatedAt", o."nextRetryAt", o."lastErrorCode",
      s."issuedAt" AS "submittedAt", s."unresolvedSlots", s."unresolvedCosts", d."finalStatus", d."reconciliationState", d."slotCount", d."unknownSince", d."reviewed7dAt", d."responsibilityReviewedAt", d."nextReviewAt"
    FROM "NotificationOutbox" o LEFT JOIN "NotificationDispatch" d ON d."outboxId" = o."id"
    LEFT JOIN LATERAL (SELECT MIN("issuedAt") FILTER (WHERE "entryKind" = 'SEND_SLOT') AS "issuedAt",
      COUNT(*) FILTER (WHERE "entryKind" = 'SEND_SLOT' AND "status" IN ('in_flight', 'unknown'))::int AS "unresolvedSlots",
      COUNT(*) FILTER (WHERE "entryKind" IN ('SEND_SLOT', 'LOOKUP_COST') AND "reservedMilliKrw" > 0)::int AS "unresolvedCosts"
      FROM "NotificationCostReservation" WHERE "dispatchId" = d."id") s ON true
    LEFT JOIN LATERAL (SELECT MAX("occurredAt") AS "lastAt" FROM "NotificationAudit" WHERE ("outboxId" = o."id" OR "dispatchId" = d."id") AND ("toState" IS NOT NULL OR "eventType" IN ('outbox_claimed', 'outbox_recovered', 'outbox_failed', 'outbox_skipped', 'result_unknown', 'result_recorded', 'closed_unconfirmed'))) a ON true
    WHERE o."eventKind" = 'application.received' AND o."audience" = 'admin'
      AND (${safeFilter} = 'all' OR (${safeFilter} = 'failed' AND o."status" = 'failed') OR (${safeFilter} = 'skipped' AND o."status" = 'skipped')
        OR (${safeFilter} = 'unknown' AND (o."lastErrorCode" = 'provider_result_unknown' OR d."finalStatus" = 'unknown' OR s."unresolvedSlots" > 0 OR d."reconciliationState" IN ('unknown', 'open_unknown', 'awaiting_final', 'awaiting_cost', 'closed_unconfirmed')))
        OR (${safeFilter} = 'attention' AND (o."status" IN ('pending', 'processing', 'failed', 'skipped') OR s."unresolvedSlots" > 0 OR s."unresolvedCosts" > 0 OR d."finalStatus" IN ('unknown', 'delivery_failed') OR d."reconciliationState" IN ('unknown', 'open_unknown', 'awaiting_final', 'awaiting_cost', 'closed_unconfirmed'))))
    ORDER BY o."occurredAt" DESC, o."id" DESC LIMIT 21 OFFSET ${(safePage - 1) * 20}
  `, getNotificationBudget(new Date())]);
  return { rows, budget };
}

export type BudgetSnapshot = { dayRequests: number; monthRequests: number; confirmed: bigint; reserved: bigint; carry: bigint; lookupConfirmed: bigint; lookupReserved: bigint; lookupCarry: bigint; other: bigint; blocked: boolean | null };

/** Same current-period aggregates and unresolved prior-month reservations used by the guard. */
async function getNotificationBudget(now: Date): Promise<BudgetSnapshot> {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  const month = `${part("year")}-${part("month")}`;
  const day = `${month}-${part("day")}`;
  const [row] = await prisma.$queryRaw<BudgetSnapshot[]>`
    SELECT COALESCE(day."requestCount", 0)::int AS "dayRequests", COALESCE(month."requestCount", 0)::int AS "monthRequests",
      COALESCE(month."confirmedMilliKrw", 0)::bigint AS "confirmed", COALESCE(month."reservedMilliKrw", 0)::bigint AS "reserved",
      COALESCE(carry.message, 0)::bigint AS "carry", COALESCE(month."lookupConfirmedMilliKrw", 0)::bigint AS "lookupConfirmed",
      COALESCE(month."lookupReservedMilliKrw", 0)::bigint AS "lookupReserved", COALESCE(carry.lookup, 0)::bigint AS "lookupCarry",
      COALESCE(month."otherMilliKrw", 0)::bigint AS "other", runtime."blocked"
    FROM (SELECT 1) seed
    LEFT JOIN "NotificationBudgetPeriod" day ON day."environment" = 'preview' AND day."service" = 'application.received' AND day."periodType" = 'day' AND day."periodKey" = ${day}
    LEFT JOIN "NotificationBudgetPeriod" month ON month."environment" = 'preview' AND month."service" = 'application.received' AND month."periodType" = 'month' AND month."periodKey" = ${month}
    LEFT JOIN "NotificationRuntimeConfig" runtime ON runtime."environment" = 'preview'
    CROSS JOIN LATERAL (SELECT SUM(c."reservedMilliKrw") FILTER (WHERE c."entryKind" = 'SEND_SLOT') AS message, SUM(c."reservedMilliKrw") FILTER (WHERE c."entryKind" = 'LOOKUP_COST') AS lookup
      FROM "NotificationCostReservation" c JOIN "NotificationDispatch" d ON d."id" = c."dispatchId"
      WHERE d."environment" = 'preview' AND c."monthKey" < ${month} AND c."reservedMilliKrw" > 0) carry
  `;
  if (!row) throw new Error("Budget unavailable.");
  return row;
}
