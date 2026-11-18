import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPROVED_PREVIEW_MIGRATIONS, evaluateAiServicePreviewMigration } from "../../../scripts/e2e/ai-service-preview-migration-policy";

const root = "prisma/migrations";
const migration = "20261115180000_ai_service_request_auth_kind";
const sql = () => readFileSync(join(root, migration, "migration.sql"), "utf8");

describe("request authentication migration contract", () => {
    it("adds exactly the nullable text column without default, backfill or audit changes", () => {
        expect(sql().trim()).toBe('ALTER TABLE "AiServiceRequest" ADD COLUMN "authKind" TEXT;');
    });
    it("declares a nullable field with no default in Prisma", () => {
        const schema = readFileSync("prisma/schema.prisma", "utf8");
        const request = schema.match(/model AiServiceRequest \{([\s\S]*?)\n\}/)?.[1];
        expect(request).toBeDefined();
        expect(request).toMatch(/^\s*authKind\s+String\?\s*$/m);
    });
    it("adds exactly three known local-only migrations after the existing approved 27", () => {
        const names = readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
        expect(names).toEqual([...APPROVED_PREVIEW_MIGRATIONS.map(e => e.name), migration, "20261118000000_add_ai_service_skill_diag", "20261118152914_ai_service_audit_diag_purge"]);
    });
    it("preserves the contents of every previously approved migration", () => {
        for (const entry of APPROVED_PREVIEW_MIGRATIONS) {
            const contents = readFileSync(join(root, entry.name, "migration.sql"));
            expect(createHash("sha256").update(contents).digest("hex")).toBe(entry.sha256);
        }
    });
    it("does not add the local migration to the Preview approved inventory", () => {
        expect(APPROVED_PREVIEW_MIGRATIONS).toHaveLength(27);
        expect(APPROVED_PREVIEW_MIGRATIONS.map(e => e.name)).not.toContain(migration);
    });
    it("denies Preview evaluation when the repository has the extra migration", () => {
        expect(() => evaluateAiServicePreviewMigration([], root)).toThrow("AI_SERVICE_MIGRATION_INVENTORY_DENIED");
    });
});
