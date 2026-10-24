import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const sql = readFileSync("prisma/migrations/20261015090000_ai_service_followup/migration.sql", "utf8");
describe("unapplied additive service migration contract", () => {
    it("has no destructive command or existingtable rewrite", () => { expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\"(?:Program|ClassSchedule|Child|Payment|Refund)\")\b/i); });
    it("creates isolated tables with RLSandrevokes", () => {
        const names = ["Config", "ProgramPublication", "ClassPublication", "KnowledgeEntry", "Request", "BudgetMonth", "QuotaBucket", "DailyMetric", "RetentionJob", "KeyPin", "Reconciliation"];
        for (const name of names) {
            expect(sql).toContain('CREATE TABLE "AiService' + name + '"');
            expect(sql).toContain('ALTER TABLE "AiService' + name + '" ENABLE ROW LEVEL SECURITY');
            expect(sql).toContain('REVOKE ALL ON TABLE "AiService' + name + '" FROM anon, authenticated');
        }
    });
    it("protects environmenthardcap,expiry,snapshot andspend", () => {
        expect(sql).toContain('"capKrw"=1000');
        expect(sql).toContain('"capKrw"=7000');
        expect(sql).toContain("interval '90 days'");
        expect(sql).toContain('"ai_service_request_immutable_trigger"');
        expect(sql).toContain('"ai_service_budget_immutable_trigger"');
        expect(sql).toContain('"ai_service_key_pin_append_only"');
        expect(sql).toContain('"ai_service_evidence_append_only"');
        expect(sql).toContain('"ai_service_budget_no_delete"');
        expect(sql).toContain('"ai_service_dispatch_immutable_trigger"');
    });
    it("doesnotactivate any scheduler or externaltransport", () => { expect(sql).not.toMatch(/cron\.schedule|net\.http|OPENAI_API_KEY/i); });
});
