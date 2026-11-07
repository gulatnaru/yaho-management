import type { NotificationHistoryRow } from "@/server/kakao/notification-queries";
const day = 86400000;
export function reviewNeeds(row: NotificationHistoryRow, now: number) {
  if (!row.unknownSince) return { seven: false, thirty: false };
  const since = row.unknownSince.getTime();
  const seven = now >= since + 7 * day && (!row.reviewed7dAt || row.reviewed7dAt.getTime() < since + 7 * day);
  const deadline = row.responsibilityReviewedAt ? row.responsibilityReviewedAt.getTime() + 30 * day : since + 30 * day;
  const thirty = now >= deadline || !!row.nextReviewAt && now >= row.nextReviewAt.getTime();
  return { seven, thirty };
}
