BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- CreateTable
CREATE TABLE "AiServiceGuidanceAudit" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiServiceGuidanceAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiServiceGuidanceAudit_environment_topic_createdAt_idx" ON "AiServiceGuidanceAudit"("environment", "topic", "createdAt");

-- Audit rows carry no guidance text and no Kakao identity: only the
-- environment, topic, version, content sha256, ADMIN actor, and timestamps.
ALTER TABLE "AiServiceGuidanceAudit" ADD CONSTRAINT "ai_service_guidance_audit_values"
 CHECK ("environment" IN ('PREVIEW','PRODUCTION')
 AND "topic" IN ('PREPARATION','RAIN'));

-- Guard trigger: UPDATE is always refused; DELETE is refused only while the
-- row is inside the 1-year audit retention window. Rows older than 365 days
-- may be purged. Same shape as the AiServiceDeletionAudit guard (P0).
CREATE FUNCTION "ai_service_guidance_audit_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
  RAISE EXCEPTION 'AI_SERVICE_GUIDANCE_AUDIT_APPEND_ONLY';
 END IF;
 IF TG_OP = 'DELETE' AND OLD."createdAt" > now() - interval '365 days' THEN
  RAISE EXCEPTION 'AI_SERVICE_GUIDANCE_AUDIT_RETAINED';
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER "ai_service_guidance_audit_guard_trigger" BEFORE UPDATE OR DELETE ON "AiServiceGuidanceAudit"
 FOR EACH ROW EXECUTE FUNCTION "ai_service_guidance_audit_guard"();

-- No public client role receives direct table access.
ALTER TABLE "AiServiceGuidanceAudit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiServiceGuidanceAudit" FROM anon, authenticated;

COMMIT;
