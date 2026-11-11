import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { POST as publicSkill } from "@/app/api/ai-service/v1/skill/route";
import { skillHandoffCard, skillReply, type Environment } from "@/server/ai-service/contracts";
import { handleKakaoSkill } from "@/server/ai-service/skill";
import { createTools } from "@/server/ai-service/tools";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
import { realRequestPayload } from "@/tests/unit/ai-service/real-request-fixture";
import type { Dependencies } from "@/server/ai-service/handler";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });

const db = new PrismaClient();
const now = new Date("2026-10-15T00:00:00Z");
const prodSecret = "synthetic-integration-prod-secret-0123456789abcdef";
const testSecret = "synthetic-integration-test-secret-0123456789abcdef";
const guidance = "합성 준비물은 모자입니다.";
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);

function depsFor(environment: Environment, testSecretValue: string | undefined = testSecret, clockTime: Date = now): Dependencies {
    const tools = createTools(db, environment, () => clockTime);
    return {
        db, environment, secret: prodSecret, testSecret: testSecretValue, botId: "synthetic-bot", clock: () => clockTime,
        keys: { encryption: { v1: Buffer.alloc(32, 1) }, hmac: { v1: Buffer.alloc(32, 2) }, activeEncryption: "v1", activeHmac: "v1" },
        tools,
    };
}
const headersFor = (value: string) => new Headers({ "x-yaho-skill-key": value });
const countRequests = () => db.aiServiceRequest.count({ where: { environment: "PREVIEW" } });

async function cleanupPreviewRows() {
    // Budget months and key pins are append-only by design (migration
    // 20261015090000: ai_service_budget_no_delete + ai_service_key_pin_append_only
    // triggers) and can never be deleted. Requests, daily metrics, quota
    // buckets, knowledge entries and config are deletable and are removed so
    // each run starts from a 0-row baseline for those tables; the budget row
    // is asserted by delta instead (see budgetBaseline).
    await db.aiServiceRequest.deleteMany({ where: { environment: "PREVIEW" } });
    await db.aiServiceDailyMetric.deleteMany({ where: { environment: "PREVIEW" } });
    await db.aiServiceQuotaBucket.deleteMany({ where: { environment: "PREVIEW" } });
    await db.aiServiceKnowledgeEntry.deleteMany({ where: { environment: "PREVIEW" } });
    await db.aiServiceConfig.deleteMany({ where: { environment: "PREVIEW" } });
}

let budgetBaseline = 0;

beforeAll(async () => {
    await cleanupPreviewRows();
    // The (PREVIEW, 2026-10) budget row is append-only: it survives across
    // runs in this throwaway cluster, so record its usedKrw and assert
    // deltas instead of absolute values.
    budgetBaseline = (await db.aiServiceBudgetMonth.findUnique({ where: { environment_month: { environment: "PREVIEW", month: "2026-10" } } }))?.usedKrw ?? 0;
    await db.aiServiceConfig.upsert({
        where: { environment: "PREVIEW" },
        update: { paused: false, provider: "TEST_DOUBLE", model: "gpt-6-luna" },
        create: { environment: "PREVIEW", paused: false, provider: "TEST_DOUBLE", model: "gpt-6-luna",
            priceVersion: "price-v1", version: 1, inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 500,
            fxMilliKrwPerUsd: 1400000, fxCheckedAt: now, fxSource: "synthetic-bank", updatedById: "synthetic-admin" },
    });
    await db.aiServiceKnowledgeEntry.upsert({
        where: { environment_topic: { environment: "PREVIEW", topic: "PREPARATION" } },
        update: { content: guidance, approved: true },
        create: { environment: "PREVIEW", topic: "PREPARATION", content: guidance, approved: true, updatedById: "synthetic-admin" },
    });
});
afterAll(async () => {
    await cleanupPreviewRows();
    await db.$disconnect();
});

describe.sequential("real Kakao Skill request contract (isolated DB 55435)", () => {
    it("I-1 grounds a version-less real request against real PostgreSQL", async () => {
        const before = await countRequests();
        const reply = await handleKakaoSkill(headersFor(prodSecret), JSON.stringify(realRequestPayload()), `skill-contract-i1-${suffix}`, depsFor("PREVIEW"));
        expect(reply).toEqual(skillReply(guidance));
        expect(reply.version).toBe("2.0");
        expect(await countRequests()).toBe(before + 1);
        const row = await db.aiServiceRequest.findFirst({ where: { environment: "PREVIEW" }, orderBy: { createdAt: "desc" } });
        expect(row).toMatchObject({ status: "SETTLED", usedKrw: 0, category: "GUIDANCE" });
        const budget = await db.aiServiceBudgetMonth.findUnique({ where: { environment_month: { environment: "PREVIEW", month: "2026-10" } } });
        expect(budget).toMatchObject({ usedKrw: budgetBaseline, reservedKrw: 0 });
    });

    it("I-2 returns the HANDOFF card for a handoff utterance and records it", async () => {
        const before = await countRequests();
        // Distinct clock: claim() stamps createdAt from the deps clock, so a
        // shared fixed clock would tie createdAt and make the "latest row"
        // lookup below nondeterministic.
        const handoffPayload = realRequestPayload(); handoffPayload.userRequest.utterance = "야호 준비물과 우천 안내";
        const reply = await handleKakaoSkill(headersFor(prodSecret), JSON.stringify(handoffPayload), `skill-contract-i2-${suffix}`, depsFor("PREVIEW", testSecret, new Date("2026-10-15T00:01:00Z")));
        expect(reply).toEqual(skillHandoffCard());
        expect(reply.version).toBe("2.0");
        expect(await countRequests()).toBe(before + 1);
        const row = await db.aiServiceRequest.findFirst({ where: { environment: "PREVIEW" }, orderBy: { createdAt: "desc" } });
        expect(row).toMatchObject({ status: "SETTLED", usedKrw: 0, category: "HUMAN_HANDOFF" });
    });

    it("I-3 rejects version 1.0 before any ledger row is created", async () => {
        const before = await countRequests();
        const reply = await handleKakaoSkill(headersFor(prodSecret), JSON.stringify({ ...realRequestPayload(), version: "1.0" }), `skill-contract-i3-${suffix}`, depsFor("PREVIEW"));
        expect(reply).toEqual(skillHandoffCard());
        expect(await countRequests()).toBe(before);
    });

    it("I-4 allows the test secret in PREVIEW and rejects it in PRODUCTION", async () => {
        const before = await countRequests();
        const allowed = await handleKakaoSkill(headersFor(testSecret), JSON.stringify(realRequestPayload()), `skill-contract-i4a-${suffix}`, depsFor("PREVIEW", testSecret, new Date("2026-10-15T00:02:00Z")));
        expect(allowed).toEqual(skillReply(guidance));
        expect(await countRequests()).toBe(before + 1);
        const denied = await handleKakaoSkill(headersFor(testSecret), JSON.stringify(realRequestPayload()), `skill-contract-i4b-${suffix}`, depsFor("PRODUCTION"));
        expect(denied).toEqual(skillHandoffCard());
        expect(await countRequests()).toBe(before + 1);
    });

    it("I-5 keeps the public route locked at 503 with the simpleText HANDOFF", async () => {
        const response = await publicSkill(new Request("https://localhost/api/ai-service/v1/skill", {
            method: "POST",
            headers: { "x-yaho-skill-key": prodSecret, "content-type": "application/json" },
            body: JSON.stringify(realRequestPayload()),
        }));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual(skillReply());
    });
});
