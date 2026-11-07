import { describe, expect, it } from "vitest";
import { describeNotification } from "@/app/(admin)/reservation-applications/_components/notification-summary";
import type { NotificationSummary } from "@/server/kakao/notification-queries";

const base: NotificationSummary = { status: "sent", attemptCount: 0, updatedAt: new Date(0), nextRetryAt: null, submittedAt: new Date(0), finalStatus: null, reconciliationState: null, lastErrorCode: null };
describe("notification summary", () => {
  it("distinguishes provider acceptance from final delivery", () => {
    expect(describeNotification(base).state).toBe("공급자 접수");
    expect(describeNotification({ ...base, finalStatus: "delivered" }).state).toBe("최종 전달 성공");
  });
  it.each([["awaiting_final", "최종 전달 결과 대기"], ["awaiting_cost", "비용 대사 대기"], ["closed_unconfirmed", "미확정 종료"], ["unknown", "결과 불명"]])("shows %s", (reconciliationState, state) => {
    expect(describeNotification({ ...base, reconciliationState }).state).toBe(state);
  });
  it("retains later final evidence even when reconciliation state remains open", () => {
    expect(describeNotification({ ...base, reconciliationState: "awaiting_final", finalStatus: "delivered" }).state).toBe("최종 전달 성공");
    expect(describeNotification({ ...base, status: "failed", reconciliationState: "open_unknown" }).state).toBe("결과 불명");
  });
});
