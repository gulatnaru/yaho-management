-- Add a dedicated closure executor to NotificationRuntimeConfig (G4 OQ-6 option A).
-- Mirrors the existing executor columns (costExecutorId, keyExecutorId,
-- purgeExecutorId): nullable TEXT, no foreign key, no default, no relation.
-- The executor is enforced in application code (executeClosure checks
-- runtime.closureExecutorId === actorId and actorId !== runtime.ownerId);
-- no database-level constraint is added, matching the existing columns.
ALTER TABLE "NotificationRuntimeConfig" ADD COLUMN "closureExecutorId" TEXT;
