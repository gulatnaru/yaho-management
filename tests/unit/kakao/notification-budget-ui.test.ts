import { expect, it } from "vitest";
import { budgetLevels } from "@/app/(admin)/reservation-applications/_components/notification-budget";
import type { BudgetSnapshot } from "@/server/kakao/notification-queries";
const base: BudgetSnapshot = { dayRequests: 0, monthRequests: 0, confirmed: 1000000n, reserved: 500000n, carry: 900000n, lookupConfirmed: 500n, lookupReserved: 500n, lookupCarry: 1000n, other: 1000000n, blocked: true };
it("counts current and carried exposure once and distinguishes warning from limit", () => {
  expect(budgetLevels(base)).toEqual({ message: 2400000n, total: 3402000n, warning: true, hardLimit: false });
  expect(budgetLevels({ ...base, dayRequests: 20 }).hardLimit).toBe(true);
});
