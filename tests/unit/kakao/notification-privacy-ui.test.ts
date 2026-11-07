import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { NotificationSummaryView } from "@/app/(admin)/reservation-applications/_components/notification-summary";
import { NotificationBudget } from "@/app/(admin)/reservation-applications/_components/notification-budget";
vi.stubGlobal("React", React);

it("renders only the displayed state and aggregate fields", () => {
  const summary = { status: "sent", attemptCount: 0, updatedAt: new Date(0), nextRetryAt: null, submittedAt: null, finalStatus: null, reconciliationState: "awaiting_final", lastErrorCode: null, secretMarker: "SYNTHETIC_PRIVATE_MARKER" };
  const budget = { dayRequests: 1, monthRequests: 1, confirmed: 0n, reserved: 15000n, carry: 0n, lookupConfirmed: 0n, lookupReserved: 0n, lookupCarry: 0n, other: 0n, blocked: true, secretMarker: "SYNTHETIC_PRIVATE_MARKER" };
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null, React.createElement(NotificationSummaryView, { row: summary }), React.createElement(NotificationBudget, { row: budget })));
  expect(html).not.toContain("SYNTHETIC_PRIVATE_MARKER");
  expect(html).toContain("마지막 확인·갱신");
  expect(html).not.toContain("마지막 상태 변경");
  expect(html).toContain("최종 전달 결과 대기");
  expect(html).toContain("영속 차단");
});
