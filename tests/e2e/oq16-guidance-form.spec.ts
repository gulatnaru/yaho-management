import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

// The DB safety gate is enforced by playwright.oq16.config.ts at load
// (it imports the repo gate with port 55435 explicitly allowed via
// `additionalPorts`). This spec deliberately imports no gate itself: it
// must still load cleanly under the main config's `playwright test --list`
// (where it is skipped — see below) even when the /tmp files are gone
// after a VM replacement.

// OQ-16 form-layer regression test (D-13). The browser fills the real
// guidance form and clicks "안내 저장", so the submission goes through the
// same form layer that turned textarea LF newlines into CRLF on Preview.
// The server under test is a `next start` instance the harness starts
// separately (VERCEL_ENV=preview, AUTH_TRUST_HOST=true) against the
// isolated DB on port 55435; this config never starts a server itself.
// Preview/Production are not touched. Run only via
// playwright.oq16.config.ts — never via the main playwright.config.ts
// (its webServer would start `npm run dev` on port 3000).

// This spec only runs under playwright.oq16.config.ts, which sets
// OQ16_FORM_BASE_URL. Under any other config it is skipped at collection
// time, so `playwright test --list` (and the full e2e suite) stays green.
test.skip(!process.env.OQ16_FORM_BASE_URL, "OQ-16 form test runs only under playwright.oq16.config.ts");

const db = new PrismaClient();
const ADMIN_EMAIL = "repro-admin@test.local";
const PREP_SHA = "d6a5a3aa9d0bae04c518170c335401f9b934f4a4a99bd001812681201aafc41a";
const RAIN_SHA = "87d5f1729d43bd563ef9bc826709a6fcc8944614a98cf2aa479823a5d9d870c3";
const prep = readFileSync(path.join(__dirname, "..", "fixtures", "approved-guidance-v1", "preparation-v1.txt"), "utf8");
const rain = readFileSync(path.join(__dirname, "..", "fixtures", "approved-guidance-v1", "rain-v1.txt"), "utf8");
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

let adminId = "";

async function auditCount() {
    return db.aiServiceGuidanceAudit.count({ where: { environment: "PREVIEW" } });
}

// Extract one multipart/form-data part value, byte-preserving (latin1).
function extractFormField(body: Buffer, field: string): string {
    const text = body.toString("latin1");
    const marker = `name="${field}"`;
    const at = text.indexOf(marker);
    if (at < 0) throw new Error(`field ${field} not found in submitted body`);
    const start = text.indexOf("\r\n\r\n", at);
    if (start < 0) throw new Error("multipart part header terminator not found");
    const valueStart = start + 4;
    const end = text.indexOf("\r\n--", valueStart);
    if (end < 0) throw new Error("multipart part terminator not found");
    return text.slice(valueStart, end);
}

const countOccurrences = (value: string, needle: string) => (value.match(new RegExp(needle, "g")) ?? []).length;

test.beforeAll(async () => {
    const password = process.env.OQ16_TEST_ADMIN_PASSWORD;
    if (!password) throw new Error("OQ16_TEST_ADMIN_PASSWORD 환경변수가 필요합니다.");
    const passwordHash = await hash(password, 10);
    const admin = await db.user.upsert({
        where: { email: ADMIN_EMAIL },
        update: { password: passwordHash, role: "ADMIN", isActive: true, mustChangePassword: false },
        create: { email: ADMIN_EMAIL, name: "OQ-16 재현용 테스트 ADMIN", password: passwordHash, role: "ADMIN", isActive: true, mustChangePassword: false },
    });
    adminId = admin.id;
    await db.aiServiceKnowledgeEntry.deleteMany({ where: { environment: "PREVIEW", topic: { in: ["PREPARATION", "RAIN"] } } });
});

test.afterAll(async () => {
    // Restore the standing state of this throwaway cluster (0 rows — the
    // repro deleted the synthetic PREPARATION row before submitting).
    // Guidance audit rows are append-only and stay as documented residue.
    await db.aiServiceKnowledgeEntry.deleteMany({ where: { environment: "PREVIEW", topic: { in: ["PREPARATION", "RAIN"] } } });
    await db.$disconnect();
});

async function loginAsAdmin(page: Page) {
    const password = process.env.OQ16_TEST_ADMIN_PASSWORD as string;
    await page.goto("/login");
    await page.getByLabel("이메일").fill(ADMIN_EMAIL);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
}

test("form submission stores PREPARATION and RAIN despite CRLF (D-13)", async ({ page }) => {
    await loginAsAdmin(page);
    const bodies: Buffer[] = [];
    await page.route("**/ai-service/guidance", async (route) => {
        const request = route.request();
        if (request.method() === "POST") {
            const buffer = request.postDataBuffer();
            if (buffer) bodies.push(buffer);
        }
        await route.continue();
    });

    const cases = [
        { topic: "PREPARATION", fixture: prep, sha: PREP_SHA, newlines: 10, chars: 269 },
        { topic: "RAIN", fixture: rain, sha: RAIN_SHA, newlines: 8, chars: 385 },
    ] as const;

    for (const { topic, fixture, sha, newlines, chars } of cases) {
        const before = await auditCount();
        await page.goto("/ai-service/guidance");
        const section = page.locator("section", { has: page.getByRole("heading", { name: `${topic} (v1)` }) });
        await expect(section).toContainText("미등록");
        const textarea = section.getByLabel("승인 원문 전문");
        await textarea.fill(fixture);
        // Pre-submit field check: the DOM value is the LF original.
        const fieldValue = await textarea.inputValue();
        expect(fieldValue).toBe(fixture);
        expect(fieldValue.length).toBe(chars);
        expect(countOccurrences(fieldValue, "\\n")).toBe(newlines);
        expect(fieldValue.endsWith(".")).toBe(true);

        const postsBefore = bodies.length;
        await section.getByRole("button", { name: "안내 저장" }).click();
        await expect(section).toContainText(`내용 해시 ${sha}`);
        expect(bodies.length).toBe(postsBefore + 1);
        const submitted = extractFormField(bodies[bodies.length - 1], "_1_content");
        // The form layer still sends CRLF — and the server now accepts it.
        expect(countOccurrences(submitted, "\\r\\n")).toBe(newlines);
        expect(countOccurrences(submitted.replace(/\r\n/g, ""), "\\n")).toBe(0);
        expect(submitted).toBe(Buffer.from(fixture.replace(/\n/g, "\r\n"), "utf8").toString("latin1"));

        const row = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic } } });
        expect(row).not.toBeNull();
        expect(row!.content).toBe(fixture);
        expect(sha256(row!.content)).toBe(sha);
        expect(row!.approved).toBe(true);
        expect(row!.version).toBe(1);
        expect(await auditCount()).toBe(before + 1);
        const audit = await db.aiServiceGuidanceAudit.findFirst({ where: { environment: "PREVIEW", topic }, orderBy: { createdAt: "desc" } });
        expect(audit).toMatchObject({ topic, version: 1, contentSha256: sha, actorId: adminId });
    }
});
