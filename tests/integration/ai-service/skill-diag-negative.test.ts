import { createHash } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { POST } from "@/app/api/ai-service/v1/skill/route";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const secret = "synthetic-only-secret-0123456789abcdef";
const pii = ["010-1234-5678", "synthetic@example.invalid", "900101-1234567", "synthetic-health-condition"];
const ids: string[] = [];
function setup() {
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("AI_SERVICE_SYNTHETIC_ENABLED", "true");
    vi.stubEnv("AI_SERVICE_SKILL_SECRET", "p".repeat(32)); vi.stubEnv("AI_SERVICE_SKILL_TEST_SECRET", secret);
    vi.stubEnv("AI_SERVICE_SYNTHETIC_RUN_ID", "test-run-123"); vi.stubEnv("AI_SERVICE_SYNTHETIC_EXPIRES_AT", "2999-01-01T00:00:00Z");
}
const request = (key: string, body: string) => new Request("http://localhost/api/ai-service/v1/skill", { method: "POST", headers: { "x-yaho-skill-key": key }, body });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => { await prisma.aiServiceSkillDiag.deleteMany({ where: { correlationId: { in: ids } } }); await prisma.$disconnect(); });
describe.sequential("diagnostic output excludes supplied data", () => {
    it.each(["{", "{}", JSON.stringify({ bot: { id: pii.join(" ") }, userRequest: { user: { id: secret }, block: { id: secret }, utterance: pii.join(" ") } })])("T-NEG-1/2/3 excludes secret and PII for malformed or mismatched input", async body => {
        setup(); const start = new Date(); const res = await POST(request(secret, body));
        const rows = await prisma.aiServiceSkillDiag.findMany({ where: { emittedAt: { gte: start } }, orderBy: { emittedAt: "desc" } });
        expect(res.status).toBe(503); expect(rows).toHaveLength(1); ids.push(rows[0].correlationId);
        const output = JSON.stringify({ row: rows[0], headers: Object.fromEntries(res.headers), body: await res.text() });
        for (const value of [secret, secret.slice(0, 8), secret.slice(-8), createHash("sha256").update(secret).digest("hex"), ...pii]) expect(output).not.toContain(value);
        for (const value of pii) for (let start = 0; start + 5 <= value.length; start++) expect(output).not.toContain(value.slice(start, start + 5));
        expect(output).not.toContain("Unexpected token"); expect(output).not.toContain("ZodError");
    });
    it.each(["header", "bot", "user", "block", "utterance", "key-env", "hmac-env", "prod-env", "test-env"])("T-NEG-1 excludes sentinel from %s across DB, fallback and response", async field => {
        setup();
        const sentinel = "sentinelABC9876543210abcdefXYZ123456";
        const bodyValue = { bot: { id: field === "bot" ? sentinel : "synthetic-bot" }, userRequest: {
            user: { id: field === "user" ? sentinel : "synthetic-test-run-123" },
            block: { id: field === "block" ? sentinel : "synthetic-block" },
            utterance: field === "utterance" ? sentinel : "야호 준비물을 알려 주세요" } };
        if (field === "key-env" || field === "hmac-env") {
            vi.stubEnv("AI_SERVICE_BOT_ID", "synthetic-bot");
            vi.stubEnv("AI_SERVICE_ENCRYPTION_KEYS", field === "key-env" ? sentinel : JSON.stringify({ v1: Buffer.alloc(32, 1).toString("base64") }));
            if (field === "hmac-env") vi.stubEnv("AI_SERVICE_HMAC_KEYS", sentinel);
        }
        if (field === "prod-env") vi.stubEnv("AI_SERVICE_SKILL_SECRET", sentinel);
        if (field === "test-env") vi.stubEnv("AI_SERVICE_SKILL_TEST_SECRET", sentinel);
        const key = field === "header" || field === "test-env" ? sentinel : secret;
        const body = field === "prod-env" || field === "test-env" ? "{" : JSON.stringify(bodyValue); const start = new Date();
        const response = await POST(request(key, body));
        const rows = await prisma.aiServiceSkillDiag.findMany({ where: { emittedAt: { gte: start } }, orderBy: { emittedAt: "desc" } });
        expect(rows).toHaveLength(1); ids.push(rows[0].correlationId);
        const create = vi.spyOn(prisma.aiServiceSkillDiag, "create").mockRejectedValueOnce(new Error(sentinel));
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const fallbackResponse = await POST(request(key, body)); expect(create).toHaveBeenCalledOnce(); expect(log).toHaveBeenCalledOnce();
        const output = JSON.stringify({ row: rows[0], log: log.mock.calls, firstHeaders: Object.fromEntries(response.headers), secondHeaders: Object.fromEntries(fallbackResponse.headers), body: await response.text() });
        for (const value of [sentinel, sentinel.slice(0, 8), sentinel.slice(-8), createHash("sha256").update(sentinel).digest("hex"), secret, secret.slice(0, 8), secret.slice(-8), createHash("sha256").update(secret).digest("hex")]) expect(output).not.toContain(value);
    });
    it("T-NEG-4 console fallback has the exact safe shape and omits absent flag", async () => {
        setup(); vi.spyOn(prisma.aiServiceSkillDiag, "create").mockRejectedValue(new Error(secret));
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        await POST(request(secret, "{")); const line = log.mock.calls[0][0] as string; const value = JSON.parse(line);
        expect(Object.keys(value).sort()).toEqual(["code", "corr", "dep", "diag", "env", "ts", "v"]);
        expect(value.code).toBe("S6_BODY_JSON_INVALID"); expect(line).not.toContain(secret);
    });
});
