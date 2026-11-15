import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readState } from "@/server/ai-service/admin";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const id = randomUUID();
const now = new Date();
const expiresAt = new Date(now.getTime() + 90 * 86400000);
const attemptDeadline = new Date(now.getTime() + 3500);
const requestHash = `v1:${"a".repeat(64)}`;
const payloadHash = `v1:${"b".repeat(64)}`;
const subjectHash = `v1:${"c".repeat(64)}`;
const actor = { userId: "synthetic-migration-admin", role: "ADMIN", active: true };
beforeAll(async () => {
    await db.aiServiceBudgetMonth.upsert({ where: { environment_month: { environment: "PREVIEW", month: "2026-07" } }, update: {}, create: { id: "PREVIEW:2026-07", environment: "PREVIEW", month: "2026-07", capKrw: 1000 } });
});
afterAll(async () => { await db.aiServiceRequest.deleteMany({ where: { id } }); await db.$disconnect(); });

describe.sequential("nullable authKind migration on owned isolated PostgreSQL", () => {
    it("has one nullable text column and no default", async () => {
        const columns = await db.$queryRaw<{ data_type: string; is_nullable: string; column_default: string | null }[]>`
            SELECT data_type, is_nullable, column_default FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'AiServiceRequest' AND column_name = 'authKind'`;
        expect(columns).toEqual([{ data_type: "text", is_nullable: "YES", column_default: null }]);
    });
    it("accepts legacy inserts and reads/updates using only the old column list", async () => {
        await db.$executeRaw`INSERT INTO "AiServiceRequest" ("id", "environment", "month", "requestKey", "requestHashes", "payloadHash", "subjectHashes", "status", "reservedKrw", "provider", "model", "priceSnapshot", "createdAt", "expiresAt", "attemptDeadline")
            VALUES (${id}, 'PREVIEW', '2026-07', ${`legacy-${id}`}, ARRAY[${requestHash}]::text[], ${payloadHash}, ARRAY[${subjectHash}]::text[], 'SETTLED', 2, 'DETERMINISTIC', 'deterministic-v1', '{}'::jsonb, ${now}, ${expiresAt}, ${attemptDeadline})`;
        const oldView = await db.$queryRaw<{ id: string; status: string }[]>`SELECT "id", "status" FROM "AiServiceRequest" WHERE "id" = ${id}`;
        expect(oldView).toEqual([{ id, status: "SETTLED" }]);
        await db.$executeRaw`UPDATE "AiServiceRequest" SET "category" = 'GUIDANCE' WHERE "id" = ${id}`;
        const stored = await db.aiServiceRequest.findUniqueOrThrow({ where: { id } });
        expect(stored).toMatchObject({ authKind: null, category: "GUIDANCE", payloadHash });
    });
    it("represents the null value as unknown in authorized, unexpired metadata", async () => {
        const state = await readState(db, "PREVIEW", actor, now);
        const row = state.consultations.find(value => value.id === id);
        expect(row).toMatchObject({ id, authKind: "unknown", category: "GUIDANCE" });
    });
});
