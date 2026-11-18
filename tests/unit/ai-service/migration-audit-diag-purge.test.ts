import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("prisma/migrations/20261118152914_ai_service_audit_diag_purge/migration.sql", "utf8");

describe("diagnostic purge audit migration contract", () => {
    it("only replaces the audit CHECK without destructive data operations", () => {
        expect(sql).toMatch(/DROP CONSTRAINT "ai_service_deletion_audit_values"/);
        expect(sql).toMatch(/ADD CONSTRAINT "ai_service_deletion_audit_values"/);
        expect(sql).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA)|TRUNCATE|DELETE\s+FROM|UPDATE)\b/i);
        expect(sql.match(/\bALTER TABLE\b/g)).toHaveLength(2);
    });
    it("preserves existing values and adds DIAG_PURGE", () => {
        expect(sql).toContain("'PREVIEW','PRODUCTION'");
        expect(sql).toContain("'DELETE_SINGLE','DELETE_BULK','READ_CONSULTATION','EMERGENCY_PAUSE','DIAG_PURGE'");
        expect(sql).toContain("'USER_REQUEST','ADMIN_REVIEW','ADMIN_READ','EMERGENCY_PAUSE'");
        expect(sql).toContain("'SINGLE','BULK','READ','CONFIG'");
    });
    it("leaves the retention guard trigger and function unchanged", () => {
        expect(sql).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:TRIGGER|FUNCTION)\b/i);
        expect(sql).not.toContain("ai_service_deletion_audit_guard");
    });
});
