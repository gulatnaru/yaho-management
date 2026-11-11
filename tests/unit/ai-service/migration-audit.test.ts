import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const sql = readFileSync("prisma/migrations/20261112090000_ai_service_deletion_audit/migration.sql", "utf8");
describe("OQ-12 P0 deletion-audit migration contract", () => {
    it("has no destructive command or existing-table rewrite", () => {
        expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);
        expect(sql).not.toMatch(/UPDATE\s+\"(?:Program|ClassSchedule|Child|Payment|Refund|AiService\w+)\"/i);
    });
    it("adds the schedulerEnabled gate column to AiServiceConfig", () => {
        expect(sql).toContain('ALTER TABLE "AiServiceConfig" ADD COLUMN "schedulerEnabled" BOOLEAN NOT NULL DEFAULT false');
    });
    it("creates the audit table with RLS and revokes", () => {
        expect(sql).toContain('CREATE TABLE "AiServiceDeletionAudit"');
        expect(sql).toContain('ALTER TABLE "AiServiceDeletionAudit" ENABLE ROW LEVEL SECURITY');
        expect(sql).toContain('REVOKE ALL ON TABLE "AiServiceDeletionAudit" FROM anon, authenticated');
        expect(sql).toContain('CREATE INDEX "AiServiceDeletionAudit_environment_createdAt_idx"');
        expect(sql).toContain('CREATE INDEX "AiServiceDeletionAudit_environment_requestId_idx"');
    });
    it("constrains audit kind, reason code and scope to the approved code sets", () => {
        expect(sql).toContain("ai_service_deletion_audit_values");
        expect(sql).toContain("'DELETE_SINGLE','DELETE_BULK','READ_CONSULTATION'");
        expect(sql).toContain("'USER_REQUEST','ADMIN_REVIEW','ADMIN_READ'");
        expect(sql).toContain("'SINGLE','BULK','READ'");
    });
    it("guards audit rows with the 365-day retention trigger, not the financial append-only function", () => {
        expect(sql).toContain("ai_service_deletion_audit_guard");
        expect(sql).toContain("interval '365 days'");
        expect(sql).toContain("ai_service_deletion_audit_guard_trigger");
        expect(sql).not.toContain("ai_service_financial_append_only");
    });
    it("does not activate any scheduler or external transport", () => {
        expect(sql).not.toMatch(/cron\.schedule|net\.http|OPENAI_API_KEY/i);
    });
});
