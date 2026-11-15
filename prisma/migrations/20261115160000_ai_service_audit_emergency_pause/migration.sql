BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "AiServiceDeletionAudit" DROP CONSTRAINT "ai_service_deletion_audit_values";
ALTER TABLE "AiServiceDeletionAudit" ADD CONSTRAINT "ai_service_deletion_audit_values"
 CHECK ("environment" IN ('PREVIEW','PRODUCTION')
 AND "kind" IN ('DELETE_SINGLE','DELETE_BULK','READ_CONSULTATION','EMERGENCY_PAUSE')
 AND "reasonCode" IN ('USER_REQUEST','ADMIN_REVIEW','ADMIN_READ','EMERGENCY_PAUSE')
 AND "scope" IN ('SINGLE','BULK','READ','CONFIG'));

COMMIT;
