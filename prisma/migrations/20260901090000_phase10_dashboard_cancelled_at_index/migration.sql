-- Phase 10: support KST day-range aggregation of reservation cancellation activity.
CREATE INDEX "Reservation_cancelledAt_idx" ON "Reservation"("cancelledAt");
