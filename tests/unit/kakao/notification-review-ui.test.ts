import { expect, it } from "vitest";
import { reviewNeeds } from "@/app/(admin)/reservation-applications/_components/notification-review";
import type { NotificationHistoryRow } from "@/server/kakao/notification-queries";
it("marks deadlines inclusive and repeats the responsible review", () => {
  const row = { unknownSince: new Date(0), reviewed7dAt: null, responsibilityReviewedAt: null, nextReviewAt: null } as NotificationHistoryRow;
  expect(reviewNeeds(row, 7 * 86400000 - 1).seven).toBe(false);
  expect(reviewNeeds(row, 7 * 86400000).seven).toBe(true);
  expect(reviewNeeds(row, 30 * 86400000).thirty).toBe(true);
  expect(reviewNeeds({ ...row, responsibilityReviewedAt: new Date(30 * 86400000) }, 60 * 86400000).thirty).toBe(true);
});
