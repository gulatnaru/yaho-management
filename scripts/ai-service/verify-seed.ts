import { PrismaClient } from "@prisma/client";
import { readState } from "../../server/ai-service/admin";
import { environmentSchema, type Actor } from "../../server/ai-service/contracts";
import { verifySeedProfile, type SeedProfile } from "../../server/ai-service/seed-profile";

/**
 * Read-only seed verification for the AI Service (PLAN §1 W-4).
 *
 * Usage: npx tsx scripts/ai-service/verify-seed.ts <environment> <profile>
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
const TOPICS = ["PREPARATION", "RAIN", "POLICY"] as const;

async function main() {
    const parsedEnvironment = environmentSchema.safeParse(process.argv[2] ?? null);
    const profile = process.argv[3];
    if (!parsedEnvironment.success || (profile !== "safe-off" && profile !== "preview-synthetic") || process.argv.length !== 4) {
        console.error("Usage: npx tsx scripts/ai-service/verify-seed.ts <environment> <safe-off|preview-synthetic>");
        process.exitCode = 2;
        return;
    }
    const environment = parsedEnvironment.data;
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
            const result = verifySeedProfile(config, profile as SeedProfile, now);
            for (const line of result.lines) console.log(line);
            failures.push(...result.failures);
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
