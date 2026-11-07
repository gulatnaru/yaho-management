import { PrismaClient } from "@prisma/client";
import { readState } from "../../server/ai-service/admin";
import { environmentSchema, type Actor } from "../../server/ai-service/contracts";

/**
 * Read-only seed verification for the AI Service (PLAN §1 W-4).
 *
 * Usage: npx tsx scripts/ai-service/verify-seed.ts <environment>
 * The environment comes from the argument only; this script has no
 * environment branches and no database URL (the Prisma client reads
 * DATABASE_URL / DIRECT_URL from the process environment).
 *
 * It only reads, via readState: (a) the config row's paused / provider /
 * model / priceVersion / prices / FX / fxCheckedAt freshness (72h) /
 * fxSource, (b) the publication rows' counts and enabled flags,
 * (c) the approval state of the three guidance topics. A config mismatch
 * exits non-zero. Publication and guidance rows are reported, not failed:
 * a missing guidance topic is a valid state (its questions HANDOFF), and
 * a publication may legitimately be withdrawn (enabled false).
 *
 * This phase runs it against the isolated database with synthetic data
 * only. It must not be run against real data.
 */
const EXPECTED = {
    paused: false,
    provider: "OPENAI",
    model: "gpt-6-luna",
    priceVersion: "price-v1",
    inputNanoUsdPerToken: 100,
    outputNanoUsdPerToken: 500,
    fxMilliKrwPerUsd: 1_400_000,
    fxSource: "mid-market 2026-11-07 ~1364; planning 1400",
} as const;
const FX_MAX_AGE_MS = 72 * 3600 * 1000;
const TOPICS = ["PREPARATION", "RAIN", "POLICY"] as const;

async function main() {
    const environment = environmentSchema.parse(process.argv[2] ?? null);
    const actor: Actor = { userId: "verify-seed-script", role: "ADMIN", active: true };
    const db = new PrismaClient();
    try {
        const now = new Date();
        const state = await readState(db, environment, actor, now);
        const failures: string[] = [];
        const config = state.config;
        if (!config) {
            failures.push("config row is missing");
        } else {
            const checks: [string, unknown, unknown][] = [
                ["paused", config.paused, EXPECTED.paused],
                ["provider", config.provider, EXPECTED.provider],
                ["model", config.model, EXPECTED.model],
                ["priceVersion", config.priceVersion, EXPECTED.priceVersion],
                ["inputNanoUsdPerToken", config.inputNanoUsdPerToken, EXPECTED.inputNanoUsdPerToken],
                ["outputNanoUsdPerToken", config.outputNanoUsdPerToken, EXPECTED.outputNanoUsdPerToken],
                ["fxMilliKrwPerUsd", config.fxMilliKrwPerUsd, EXPECTED.fxMilliKrwPerUsd],
                ["fxSource", config.fxSource, EXPECTED.fxSource],
            ];
            for (const [name, actual, expected] of checks) {
                console.log(`config.${name}: ${String(actual)} (expected ${String(expected)}) ${actual === expected ? "OK" : "MISMATCH"}`);
                if (actual !== expected) failures.push(`config.${name} is ${String(actual)}, expected ${String(expected)}`);
            }
            const fxAgeMs = now.getTime() - new Date(config.fxCheckedAt).getTime();
            const fxFresh = fxAgeMs >= 0 && fxAgeMs <= FX_MAX_AGE_MS;
            console.log(`config.fxCheckedAt: ${new Date(config.fxCheckedAt).toISOString()} (age ${Math.round(fxAgeMs / 3600000)}h, limit 72h) ${fxFresh ? "OK" : "MISMATCH"}`);
            if (!fxFresh) failures.push("config.fxCheckedAt is older than 72h");
        }
        console.log(`programs: ${state.programs.length} rows`);
        for (const p of state.programs) console.log(`  program ${p.id}: enabled=${p.enabled}`);
        console.log(`classes: ${state.classes.length} rows`);
        for (const c of state.classes) console.log(`  class ${c.id}: enabled=${c.enabled}`);
        for (const topic of TOPICS) {
            const entry = state.knowledge.find(k => k.topic === topic);
            console.log(`guidance.${topic}: ${entry ? (entry.approved ? "approved" : "stored, not approved") : "not stored (HANDOFF)"}`);
        }
        if (failures.length) {
            for (const f of failures) console.error("FAIL: " + f);
            process.exitCode = 1;
        } else {
            console.log("verify-seed: OK");
        }
    } finally {
        await db.$disconnect();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
