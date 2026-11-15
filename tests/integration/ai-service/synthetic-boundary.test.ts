import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ai-service/v1/skill/route";
import { hashes } from "@/server/ai-service/crypto";
import { skillHandoffCard, skillReply } from "@/server/ai-service/contracts";
import { realRequestPayload } from "@/tests/unit/ai-service/real-request-fixture";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const run = `scope-${randomUUID()}`;
const prod = "synthetic-integration-prod-secret-0123456789abcdef";
const test = "synthetic-integration-test-secret-0123456789abcdef";
const keys = { encryption: { v1: Buffer.alloc(32, 1) }, hmac: { v1: Buffer.alloc(32, 2) }, activeEncryption: "v1", activeHmac: "v1" };
const subjectHashes = hashes(keys, "subject", "PREVIEW", `synthetic-${run}`);
const rows = () => db.aiServiceRequest.findMany({ where: { environment: "PREVIEW", subjectHashes: { hasSome: subjectHashes } } });
const payload = (utterance = "야호 준비물을 알려 주세요") => {
    const value = realRequestPayload();
    value.userRequest.user.id = `synthetic-${run}`;
    value.userRequest.utterance = utterance;
    return value;
};
const request = (body: unknown, secret = test) => new Request("https://localhost/api/ai-service/v1/skill", {
    method: "POST", headers: { "content-type": "application/json", "x-yaho-skill-key": secret }, body: JSON.stringify(body),
});
function enable() {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AI_SERVICE_SYNTHETIC_ENABLED", "true");
    vi.stubEnv("AI_SERVICE_SYNTHETIC_RUN_ID", run);
    vi.stubEnv("AI_SERVICE_SYNTHETIC_EXPIRES_AT", new Date(Date.now() + 3600000).toISOString());
    vi.stubEnv("AI_SERVICE_SKILL_SECRET", prod);
    vi.stubEnv("AI_SERVICE_SKILL_TEST_SECRET", test);
    vi.stubEnv("AI_SERVICE_BOT_ID", "synthetic-bot");
    vi.stubEnv("AI_SERVICE_ENCRYPTION_KEYS", JSON.stringify({ v1: keys.encryption.v1.toString("base64") }));
    vi.stubEnv("AI_SERVICE_HMAC_KEYS", JSON.stringify({ v1: keys.hmac.v1.toString("base64") }));
    vi.stubEnv("AI_SERVICE_ENCRYPTION_ACTIVE", "v1");
    vi.stubEnv("AI_SERVICE_HMAC_ACTIVE", "v1");
}
const config = (paused: boolean) => ({ paused, schedulerEnabled: false, provider: "TEST_DOUBLE", model: "gpt-6-luna", priceVersion: "price-v1", inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 500, fxMilliKrwPerUsd: 1400000, fxCheckedAt: new Date(), fxSource: "synthetic-bank", updatedById: "synthetic-scope-test" });
const saveConfig = async (paused: boolean) => db.aiServiceConfig.upsert({ where: { environment: "PREVIEW" }, update: config(paused), create: { environment: "PREVIEW", ...config(paused) } });
beforeAll(async () => { enable(); await db.aiServiceConfig.deleteMany({ where: { environment: "PREVIEW" } }); });
afterAll(async () => {
    await db.aiServiceRequest.deleteMany({ where: { environment: "PREVIEW", subjectHashes: { hasSome: subjectHashes } } });
    await db.aiServiceConfig.updateMany({ where: { environment: "PREVIEW" }, data: { paused: true, schedulerEnabled: false } });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await db.$disconnect();
});

describe.sequential("D scenarios: synthetic-only public skill boundary", () => {
    it("D3: missing Config does not claim or reserve", async () => {
        const before = await rows();
        const response = await POST(request(payload()));
        expect(response.status).toBe(200); expect(await response.json()).toEqual(skillHandoffCard());
        expect(await rows()).toHaveLength(before.length);
    });
    it("D4: paused Config does not claim", async () => {
        await saveConfig(true);
        const before = await rows();
        const response = await POST(request(payload()));
        expect(response.status).toBe(200); expect(await response.json()).toEqual(skillHandoffCard());
        expect(await rows()).toHaveLength(before.length);
    });
    it("D5: approved fixture settles test auth at zero and performs no model network call", async () => {
        await saveConfig(false);
        const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected network"));
        const before = await rows();
        const auditsBefore = await db.aiServiceDeletionAudit.count({ where: { environment: "PREVIEW" } });
        const response = await POST(request(payload()));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(skillReply("합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요."));
        const after = await rows();
        expect(after).toHaveLength(before.length + 1);
        const row = after.find(r => !before.some(old => old.id === r.id));
        expect(row).toMatchObject({ authKind: "test", status: "SETTLED", usedKrw: 0, inputTokens: 0, outputTokens: 0 });
        const budget = await db.aiServiceBudgetMonth.findUniqueOrThrow({ where: { environment_month: { environment: "PREVIEW", month: row!.month } } });
        expect(budget.reservedKrw).toBe(0);
        expect(await db.aiServiceDeletionAudit.count({ where: { environment: "PREVIEW" } })).toBe(auditsBefore);
        expect(network).not.toHaveBeenCalled();
        network.mockRestore();
    });
    it("D5: the approved rain fixture returns only synthetic guidance", async () => {
        const before = await rows();
        const response = await POST(request(payload("야호 비가 오면 운영하나요")));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(skillReply("합성 안내: 우천 시 운영 안내를 확인해 주세요."));
        const after = await rows();
        expect(after).toHaveLength(before.length + 1);
        const created = after.find(row => !before.some(old => old.id === row.id));
        expect(created).toMatchObject({ authKind: "test", status: "SETTLED", usedKrw: 0 });
        // Keep this fixture identity fresh for the later paused/reload tests.
        await db.aiServiceRequest.delete({ where: { id: created!.id } });
    });
    it("D5: a registered handoff fixture is handled without a model", async () => {
        const before = await rows();
        const response = await POST(request(payload("야호 예약을 도와 주세요")));
        expect(response.status).toBe(200); expect(await response.json()).toEqual(skillHandoffCard());
        expect(await rows()).toHaveLength(before.length + 1);
    });
    it("D6: prod secret and client synthetic claim do not reach the ledger", async () => {
        const before = await rows();
        const marked = { ...payload(), synthetic: true, surface: "test" };
        const response = await POST(request(marked, prod));
        expect(response.status).toBe(503); expect(await response.json()).toEqual(skillReply());
        expect(await rows()).toHaveLength(before.length);
    });
    it.each(["production", "", "development", "other"])("D7: environment %s cannot be overridden", async environment => {
        vi.stubEnv("VERCEL_ENV", environment);
        const before = await rows();
        for (const secret of [prod, test]) expect((await POST(request(payload(), secret))).status).toBe(503);
        expect(await rows()).toHaveLength(before.length);
        vi.stubEnv("VERCEL_ENV", "preview");
    });
    it.each(["utterance", "user", "bot", "block"])("rejects an unowned %s before claim", async field => {
        const value = payload();
        if (field === "utterance") value.userRequest.utterance = "야호 임의 실제 상담";
        if (field === "user") value.userRequest.user.id = "synthetic-other-run";
        if (field === "bot") value.bot.id = "synthetic-other-bot";
        if (field === "block") value.userRequest.block.id = "synthetic-other-block";
        const before = await rows();
        expect((await POST(request(value))).status).toBe(503);
        expect(await rows()).toHaveLength(before.length);
    });
    it("D12: a reloaded server module preserves the paused database state", async () => {
        await saveConfig(true);
        const before = await rows();
        // Reset the server module registry to model a fresh code load. The
        // persistent DB is deliberately retained across the simulated restart.
        vi.resetModules();
        const reloaded = await import("@/app/api/ai-service/v1/skill/route");
        const response = await reloaded.POST(request(payload("야호 비가 오면 운영하나요")));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(skillHandoffCard());
        expect(await rows()).toHaveLength(before.length);
        expect(await db.aiServiceConfig.findUniqueOrThrow({ where: { environment: "PREVIEW" } })).toMatchObject({ paused: true, schedulerEnabled: false });
    });
    it("D11/D12: closing and restoring the lock never clears persisted pause", async () => {
        await saveConfig(true);
        vi.stubEnv("AI_SERVICE_SYNTHETIC_ENABLED", "false");
        const before = await rows();
        expect((await POST(request(payload()))).status).toBe(503);
        vi.stubEnv("AI_SERVICE_SYNTHETIC_ENABLED", "true");
        expect((await POST(request(payload("야호 비가 오면 운영하나요")))).status).toBe(200);
        expect(await rows()).toHaveLength(before.length);
        expect(await db.aiServiceConfig.findUniqueOrThrow({ where: { environment: "PREVIEW" } })).toMatchObject({ paused: true, schedulerEnabled: false });
    });
});
