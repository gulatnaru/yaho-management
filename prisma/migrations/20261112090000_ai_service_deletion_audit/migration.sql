BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- AddColumn: schedulerEnabled gate for the auto-delete cron (P-1). Default false:
-- code may merge and deploy while automatic deletion stays inert until an ADMIN
-- enables the flag through a separate operations approval.
ALTER TABLE "AiServiceConfig" ADD COLUMN "schedulerEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AiServiceDeletionAudit" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiServiceDeletionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiServiceDeletionAudit_environment_createdAt_idx" ON "AiServiceDeletionAudit"("environment", "createdAt");

-- CreateIndex
CREATE INDEX "AiServiceDeletionAudit_environment_requestId_idx" ON "AiServiceDeletionAudit"("environment", "requestId");

-- Audit rows carry no utterance, no Kakao identity, no hash that can be
-- reconnected to a person: only the request UUID, the ADMIN actor, a reason
-- code, a scope, and timestamps.
ALTER TABLE "AiServiceDeletionAudit" ADD CONSTRAINT "ai_service_deletion_audit_values"
 CHECK ("environment" IN ('PREVIEW','PRODUCTION')
 AND "kind" IN ('DELETE_SINGLE','DELETE_BULK','READ_CONSULTATION')
 AND "reasonCode" IN ('USER_REQUEST','ADMIN_REVIEW','ADMIN_READ')
 AND "scope" IN ('SINGLE','BULK','READ'));

-- Guard trigger: UPDATE is always refused; DELETE is refused only while the
-- row is inside the 1-year audit retention window. Rows older than 365 days
-- may be purged by purgeOldAudits. The financial append-only function is
-- deliberately NOT reused here: it blocks DELETE unconditionally, which
-- would make the 1-year purge impossible.
CREATE FUNCTION "ai_service_deletion_audit_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
  RAISE EXCEPTION 'AI_SERVICE_DELETION_AUDIT_APPEND_ONLY';
 END IF;
 IF TG_OP = 'DELETE' AND OLD."createdAt" > now() - interval '365 days' THEN
  RAISE EXCEPTION 'AI_SERVICE_DELETION_AUDIT_RETAINED';
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER "ai_service_deletion_audit_guard_trigger" BEFORE UPDATE OR DELETE ON "AiServiceDeletionAudit"
 FOR EACH ROW EXECUTE FUNCTION "ai_service_deletion_audit_guard"();

-- No public client role receives direct table access.
ALTER TABLE "AiServiceDeletionAudit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiServiceDeletionAudit" FROM anon, authenticated;

COMMIT;
