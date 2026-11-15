import { test, expect, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { realRequestPayload } from "@/tests/unit/ai-service/real-request-fixture";
import { skillHandoffCard } from "@/server/ai-service/contracts";
import { reconcileMonth, settle } from "@/server/ai-service/ledger";

const db = new PrismaClient();
const run = process.env.AI_SERVICE_SYNTHETIC_RUN_ID!;
const testSecret = process.env.AI_SERVICE_SKILL_TEST_SECRET!;
const prodSecret = process.env.AI_SERVICE_SKILL_SECRET!;
let configOwned = false;
let adminId: string | undefined;
let server: ChildProcess | undefined;
const email = `${run}@example.test`;
const password = `${randomBytes(24).toString("hex")}aA1!`;
const origin = "http://127.0.0.1:3217";

async function visitAiService(page: Page, ready: Locator) {
    await page.goto("/ai-service");
    for (let retries = 0; ; retries++) {
        try {
            await expect(ready).toBeVisible();
            return;
        } catch (error) {
            if (retries >= 3 || !(await page.getByRole("button", { name: "다시 시도" }).isVisible())) throw error;
            await page.waitForTimeout(1_000);
            await page.reload();
        }
    }
}

async function stopServer() {
    if (!server) return;
    const child = server;
    server = undefined;
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
    if (child.pid) process.kill(-child.pid, "SIGTERM");
    await exited;
}

async function startServer(overrides: Record<string, string> = {}) {
    // Never reuse or terminate another process listening on the test port.
    await new Promise<void>((resolve, reject) => {
        const probe = createServer();
        probe.once("error", reject);
        probe.listen(3217, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve()));
    });
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", "3217"], {
        env: { ...process.env, VERCEL_ENV: "preview", ...overrides }, detached: true, stdio: "ignore",
    });
    server = child;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("QC2_LOCAL_SERVER_EXITED");
        try { if ((await fetch(`${origin}/login`)).ok) return; } catch { /* wait for owned server */ }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("QC2_LOCAL_SERVER_TIMEOUT");
}
const body = realRequestPayload();
body.userRequest.user.id = `synthetic-${run}`;

test.describe.serial("isolated synthetic Skill HTTP boundary", () => {
    test.describe.configure({ timeout: 180_000 });
    test.beforeAll(async () => {
        // Refuse a database with existing service state; never overwrite it.
        const counts = await Promise.all([db.aiServiceConfig.count(), db.aiServiceRequest.count(), db.aiServiceBudgetMonth.count(), db.aiServiceKeyPin.count(), db.aiServiceQuotaBucket.count()]);
        if (counts.some(Boolean)) throw new Error("QC2_LOCAL_DATABASE_NOT_EMPTY");
        await db.aiServiceConfig.create({ data: {
            environment: "PREVIEW", paused: false, schedulerEnabled: false,
            provider: "TEST_DOUBLE", model: "gpt-6-luna", priceVersion: "price-v1",
            inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 500, fxMilliKrwPerUsd: 1400000,
            fxCheckedAt: new Date(), fxSource: "synthetic-bank", updatedById: "synthetic-local-e2e",
        } });
        configOwned = true;
        const admin = await db.user.create({ data: { email, name: "Synthetic local admin", password: await hash(password, 4), role: "ADMIN" } });
        adminId = admin.id;
        await startServer();
    });
    test.afterAll(async () => {
        await stopServer();
        try {
            if (configOwned) {
                await db.aiServiceConfig.updateMany({ where: { environment: "PREVIEW", updatedById: "synthetic-local-e2e" }, data: { paused: true, schedulerEnabled: false } });
                // The empty-DB guard makes every request below suite-owned. Even
                // an interrupted HTTP request must release its ledger hold.
                for (const row of await db.aiServiceRequest.findMany({ where: { environment: "PREVIEW", status: "PROCESSING" } })) {
                    await settle(db, "PREVIEW", row.id, row.attempt, { kind: row.dispatched ? "UNKNOWN" : "UNDISPATCHED" }, new Date());
                }
                for (const month of await db.aiServiceBudgetMonth.findMany({ where: { environment: "PREVIEW", OR: [{ reservedKrw: { gt: 0 } }, { unknownCount: { gt: 0 } }] } })) {
                    await reconcileMonth(db, "PREVIEW", { userId: "synthetic-local-e2e", role: "ADMIN", active: true }, {
                        month: month.month, expectedVersion: month.version, billedKrw: month.billedKrw, heldActualKrw: 0,
                        resolveAllHeld: true, reference: `invoice-${run}-${month.month}`, coveredThroughGeneration: month.dispatchGeneration, coverageConfirmed: true,
                    }, new Date());
                }
            }
            if (adminId) await db.user.deleteMany({ where: { id: adminId } });
        } finally { await db.$disconnect(); }
    });
    test("D1/D6: real channel, missing authentication and production secret remain closed", async ({ request }) => {
        const before = await db.aiServiceRequest.count();
        for (const path of ["/api/kakao/skill", "/api/ai-service/v1/skill"]) {
            const response = await request.post(path, { data: body });
            expect(response.status()).toBe(503);
        }
        const response = await request.post("/api/ai-service/v1/skill", { data: { ...body, synthetic: true }, headers: { "x-yaho-skill-key": prodSecret } });
        expect(response.status()).toBe(503);
        expect(await db.aiServiceRequest.count()).toBe(before);
    });
    test("D2: anonymous admin access remains blocked independently", async ({ page }) => {
        await page.goto("/ai-service");
        await expect(page).toHaveURL(/\/login/);
    });
    test("D5: owned fixture settles once with test authentication", async ({ request }) => {
        const before = await db.aiServiceRequest.count();
        const response = await request.post("/api/ai-service/v1/skill", { data: body, headers: { "x-yaho-skill-key": testSecret } });
        expect(response.status()).toBe(200);
        expect(JSON.stringify(await response.json())).toContain("합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요.");
        expect(await db.aiServiceRequest.count()).toBe(before + 1);
        expect(await db.aiServiceRequest.findFirstOrThrow()).toMatchObject({ authKind: "test", status: "SETTLED", usedKrw: 0 });
        expect(await db.aiServiceDeletionAudit.count()).toBe(0);
    });
    test("D2: authenticated ADMIN sees authentication evidence while unauthenticated Skill is denied", async ({ page, request }) => {
        await page.goto("/login");
        await page.getByLabel("이메일").fill(email);
        await page.getByLabel("비밀번호").fill(password);
        await page.getByRole("button", { name: "로그인" }).click();
        await expect(page).toHaveURL(/\/dashboard/);
        await visitAiService(page, page.getByText("환경: PREVIEW", { exact: false }));
        await expect(page.getByText("환경: PREVIEW", { exact: false })).toBeVisible();
        await expect(page.getByRole("link", { name: /인증: test/ })).toBeVisible();
        const before = await db.aiServiceRequest.count();
        expect((await request.post("/api/ai-service/v1/skill", { data: body })).status()).toBe(503);
        expect(await db.aiServiceRequest.count()).toBe(before);
    });
    test("D4: persisted pause stops subsequent requests", async ({ request }) => {
        await db.aiServiceConfig.update({ where: { environment: "PREVIEW" }, data: { paused: true } });
        const before = await db.aiServiceRequest.count();
        const rain = structuredClone(body); rain.userRequest.utterance = "야호 비가 오면 운영하나요";
        const response = await request.post("/api/ai-service/v1/skill", { data: rain, headers: { "x-yaho-skill-key": testSecret } });
        expect(response.status()).toBe(200);
        expect(await db.aiServiceRequest.count()).toBe(before);
        expect(await db.aiServiceConfig.findUniqueOrThrow({ where: { environment: "PREVIEW" } })).toMatchObject({ paused: true, schedulerEnabled: false });
    });
    test("D11/D12: restoring locks and restarting preserves pause and ledger", async ({ page, request }) => {
        const before = await db.aiServiceRequest.count();
        const ledger = await db.aiServiceBudgetMonth.findMany({ orderBy: { month: "asc" } });
        const rain = structuredClone(body); rain.userRequest.utterance = "야호 비가 오면 운영하나요";
        await stopServer();
        await startServer({ AI_SERVICE_ADMIN_ENABLED: "false", AI_SERVICE_SYNTHETIC_ENABLED: "false" });
        await page.goto("/login");
        await page.getByLabel("이메일").fill(email); await page.getByLabel("비밀번호").fill(password);
        await page.getByRole("button", { name: "로그인" }).click();
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
        await visitAiService(page, page.getByRole("status").filter({ hasText: "현재 연결과 설정 변경은 비활성화" }));
        await expect(page.getByRole("status")).toContainText("현재 연결과 설정 변경은 비활성화");
        expect((await request.post("/api/ai-service/v1/skill", { data: rain, headers: { "x-yaho-skill-key": testSecret } })).status()).toBe(503);
        await stopServer();
        await startServer();
        await visitAiService(page, page.getByText("환경: PREVIEW", { exact: false }));
        const response = await request.post("/api/ai-service/v1/skill", { data: rain, headers: { "x-yaho-skill-key": testSecret } });
        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual(skillHandoffCard());
        expect(await db.aiServiceRequest.count()).toBe(before);
        expect(await db.aiServiceBudgetMonth.findMany({ orderBy: { month: "asc" } })).toEqual(ledger);
        expect(await db.aiServiceConfig.findUniqueOrThrow({ where: { environment: "PREVIEW" } })).toMatchObject({ paused: true, schedulerEnabled: false });
    });
    test("D7: production rejects authenticated admin and both Skill secrets without writes", async ({ page, request }) => {
        const before = await Promise.all([db.aiServiceRequest.count(), db.aiServiceDeletionAudit.count(), db.aiServiceBudgetMonth.findMany({ orderBy: { month: "asc" } })]);
        await stopServer();
        await startServer({ VERCEL_ENV: "production" });
        await page.goto("/login");
        await page.getByLabel("이메일").fill(email); await page.getByLabel("비밀번호").fill(password);
        await page.getByRole("button", { name: "로그인" }).click();
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
        await visitAiService(page, page.getByRole("status").filter({ hasText: "현재 연결과 설정 변경은 비활성화" }));
        await expect(page.getByRole("status")).toContainText("현재 연결과 설정 변경은 비활성화");
        for (const secret of [testSecret, prodSecret]) expect((await request.post("/api/ai-service/v1/skill", { data: body, headers: { "x-yaho-skill-key": secret } })).status()).toBe(503);
        expect(await Promise.all([db.aiServiceRequest.count(), db.aiServiceDeletionAudit.count(), db.aiServiceBudgetMonth.findMany({ orderBy: { month: "asc" } })])).toEqual(before);
    });
});
