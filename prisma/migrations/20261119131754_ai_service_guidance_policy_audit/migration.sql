ALTER TABLE "AiServiceGuidanceAudit"
  DROP CONSTRAINT "ai_service_guidance_audit_values";

ALTER TABLE "AiServiceGuidanceAudit"
  ADD CONSTRAINT "ai_service_guidance_audit_values"
  CHECK ("environment" IN ('PREVIEW','PRODUCTION')
    AND "topic" IN ('PREPARATION','RAIN','POLICY'));
