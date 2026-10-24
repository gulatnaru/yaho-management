import { expect } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";

/** Read the disposable database directly, independently of the UI's balance projection. */
export async function assertFamilyLedger(db: PrismaClient, submissionId: string, expected?: { D: number; A: number; P: number; R: number; T: number }) {
  const [deposits, mappings, obligations] = await Promise.all([
    db.applicationDeposit.findMany({ where: { submissionId }, include: { allocations: true } }),
    db.reservationApplicationPaymentMapping.findMany({ where: { application: { submissionId } }, include: { allocations: true, paymentItem: { include: { reservation: true, payment: true, refunds: true } } } }),
    db.returnObligation.findMany({ where: { submissionId }, include: { allocations: true, returns: true } }),
  ]);
  const D = deposits.reduce((sum, row) => sum + row.amount, 0);
  const P = mappings.reduce((sum, row) => sum + row.allocations.reduce((total, allocation) => total + allocation.amount, 0), 0);
  const R = obligations.reduce((sum, row) => sum + row.amount - row.returnedAmount, 0);
  const T = obligations.reduce((sum, row) => sum + row.returns.reduce((total, returned) => total + returned.amount, 0), 0);
  const A = deposits.reduce((sum, row) => sum + row.amount - row.allocations.reduce((total, allocation) => total + allocation.amount, 0), 0);
  expect(D).toBe(A + P + R + T);
  if (expected) expect({ D, A, P, R, T }).toEqual(expected);
  expect(new Set(mappings.map((row) => row.paymentItem.reservationId)).size).toBe(mappings.length);
  for (const mapping of mappings) {
    expect(mapping.paymentItem.paidAmount).toBe(mapping.allocations.reduce((sum, row) => sum + row.amount, 0));
    // An allocation has exactly one destination: returns cannot fund reservations.
    expect(mapping.allocations.every((row) => row.returnObligationId === null)).toBe(true);
    expect(mapping.paymentItem.amount - mapping.paymentItem.discountAmount).toBe(mapping.paymentItem.paidAmount);
    expect(mapping.paymentItem.refundedAmount).toBe(mapping.paymentItem.refunds.filter((row) => row.status === "COMPLETED").reduce((sum, row) => sum + row.amount, 0));
  }
  for (const obligation of obligations) {
    expect(obligation.allocations.every((row) => row.paymentMappingId === null)).toBe(true);
    expect(obligation.returnedAmount).toBe(obligation.returns.reduce((sum, row) => sum + row.amount, 0));
  }
  return { deposits, mappings, obligations, D, A, P, R, T };
}
