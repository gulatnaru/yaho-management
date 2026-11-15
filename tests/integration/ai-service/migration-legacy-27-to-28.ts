/**
 * Coordinator-only, two-phase legacy migration fixture. This script never
 * applies a migration. Run prepare against a verified isolated 27-migration
 * database, apply migration 28 outside this script, then run verify against
 * the SAME database. Both phases fail closed unless the target is local 55435.
 */
import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
loadEnvConfig(process.cwd());
if (process.env.VERCEL_ENV) throw new Error("UX_INTEGRATION_LOCAL_ONLY");
const target = assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL }, { additionalPorts: ["55435"] });
if (target.DATABASE_URL.port !== "55435" || target.DIRECT_URL.port !== "55435") throw new Error("EXPECTED_ISOLATED_PORT_55435");
const phase = process.argv[2];
if (phase !== "prepare" && phase !== "verify") throw new Error("EXPECTED_PREPARE_OR_VERIFY");
const db = new PrismaClient();
const id = "d06b2316-d5db-4698-8dd5-cb2e1d885467";
const requestKey = "synthetic-qc2-legacy-27-to-28";
const hash = `v1:${"a".repeat(64)}`;
const payloadHash = `v1:${"b".repeat(64)}`;
const subjectHash = `v1:${"c".repeat(64)}`;

async function main() {
    const columns = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'AiServiceRequest' AND column_name = 'authKind'`;
    const migrations = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`;
    assert.equal(columns[0].count, phase === "prepare" ? 0n : 1n);
    assert.equal(migrations[0].count, phase === "prepare" ? 27n : 28n);
    if (phase === "prepare") {
        const existing = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "AiServiceRequest" WHERE "id" = ${id} OR "requestKey" = ${requestKey}`;
        assert.equal(existing.length, 0);
        await db.aiServiceBudgetMonth.upsert({ where: { environment_month: { environment: "PREVIEW", month: "2026-07" } }, update: {}, create: { id: "PREVIEW:2026-07", environment: "PREVIEW", month: "2026-07", capKrw: 1000 } });
        const now = new Date(), expiresAt = new Date(now.getTime() + 90 * 86400000), deadline = new Date(now.getTime() + 3500);
        await db.$executeRaw`INSERT INTO "AiServiceRequest" ("id", "environment", "month", "requestKey", "requestHashes", "payloadHash", "subjectHashes", "status", "reservedKrw", "provider", "model", "priceSnapshot", "createdAt", "expiresAt", "attemptDeadline", "category")
          VALUES (${id}, 'PREVIEW', '2026-07', ${requestKey}, ARRAY[${hash}]::text[], ${payloadHash}, ARRAY[${subjectHash}]::text[], 'SETTLED', 2, 'DETERMINISTIC', 'deterministic-v1', '{}'::jsonb, ${now}, ${expiresAt}, ${deadline}, 'GUIDANCE')`;
        const oldView = await db.$queryRaw<{ category: string }[]>`SELECT "category" FROM "AiServiceRequest" WHERE "id" = ${id}`;
        assert.equal(oldView[0].category, "GUIDANCE");
    } else {
        const migrated = await db.$queryRaw<{ authKind: string | null; requestKey: string; payloadHash: string; category: string }[]>`SELECT "authKind", "requestKey", "payloadHash", "category" FROM "AiServiceRequest" WHERE "id" = ${id}`;
        assert.deepEqual(migrated, [{ authKind: null, requestKey, payloadHash, category: "GUIDANCE" }]);
        await db.$executeRaw`UPDATE "AiServiceRequest" SET "category" = 'HUMAN_HANDOFF' WHERE "id" = ${id}`;
        const oldView = await db.$queryRaw<{ category: string }[]>`SELECT "category" FROM "AiServiceRequest" WHERE "id" = ${id}`;
        assert.equal(oldView[0].category, "HUMAN_HANDOFF");
        const after = await db.$queryRaw<{ authKind: string | null }[]>`SELECT "authKind" FROM "AiServiceRequest" WHERE "id" = ${id}`;
        assert.equal(after[0].authKind, null);
        await db.$executeRaw`DELETE FROM "AiServiceRequest" WHERE "id" = ${id} AND "requestKey" = ${requestKey}`;
    }
    process.stdout.write(`legacy migration ${phase}: PASS\n`);
}
main().finally(async () => { await db.$disconnect(); }).catch(() => { process.stderr.write("legacy migration verification failed\n"); process.exitCode = 1; });
