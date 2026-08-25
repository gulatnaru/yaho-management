-- Phase 6: audit actor for consent records and attendance records.
ALTER TABLE "ChildConsent" ADD COLUMN "recordedById" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "attendanceRecordedById" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "attendanceRecordedAt" TIMESTAMP(3);

ALTER TABLE "ChildConsent"
  ADD CONSTRAINT "ChildConsent_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_attendanceRecordedById_fkey"
  FOREIGN KEY ("attendanceRecordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
