import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardSummary } from "@/app/(admin)/dashboard/_components/dashboard-summary";
import { getDashboardReservationLabel } from "@/server/dashboard/presentation";

describe("dashboard reservation labels", () => {
  it("distinguishes attendance history retained after cancellation", () => {
    expect(getDashboardReservationLabel("CANCELLED", "PRESENT")).toBe("참여완료 후 취소");
    expect(getDashboardReservationLabel("CANCELLED", "ABSENT")).toBe("노쇼 후 취소");
  });

  it("labels active operation states", () => {
    expect(getDashboardReservationLabel("RESERVED", null)).toBe("예약됨");
    expect(getDashboardReservationLabel("COMPLETED", "PRESENT")).toBe("참여완료");
    expect(getDashboardReservationLabel("NO_SHOW", "ABSENT")).toBe("노쇼");
  });
});

describe("dashboard summary links", () => {
  const props = {
    financialMetrics: undefined,
    metrics: { classCount: 2, operationReservationCount: 5, cancellationCount: 1 },
    today: "2026-09-20",
  };

  it("keeps reservation links for ADMIN and MANAGER views", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardSummary, { ...props, canAccessReservations: true }),
    );

    expect(html).toContain('data-testid="summary-operation-reservations" href="/reservations"');
    expect(html).toContain(
      'data-testid="summary-cancellations" href="/reservations?status=CANCELLED"',
    );
  });

  it("renders TEACHER reservation metrics as non-interactive cards", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardSummary, { ...props, canAccessReservations: false }),
    );

    expect(html).toContain('data-testid="summary-operation-reservations"');
    expect(html).toContain("5명");
    expect(html).toContain('data-testid="summary-cancellations"');
    expect(html).toContain("1건");
    expect(html).not.toContain('href="/reservations"');
    expect(html).not.toContain('href="/reservations?status=CANCELLED"');
  });
});
