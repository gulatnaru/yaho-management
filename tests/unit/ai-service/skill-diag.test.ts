import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { SkillDiagCode as C, SkillDiagDenied, emitSkillDiag } from "@/server/ai-service/skill-diag";
import { authenticateSkill } from "@/server/ai-service/transport";
import { validateSyntheticScope, assertSyntheticScope } from "@/server/ai-service/synthetic-scope";
import { deriveStableRequestId } from "@/server/ai-service/request-id";
import { assertSyntheticSkillEnabled } from "@/server/ai-service/runtime";
import { createLiveDependencies } from "@/server/ai-service/factory";
import { readServiceKeys } from "@/server/ai-service/keys";
import { ServiceDenied } from "@/server/ai-service/contracts";
import { purgeOldSkillDiag } from "@/server/ai-service/retention";
import { fakeDb } from "./fake-db";

const prod = "p".repeat(32), test = "t".repeat(32);
const headers = (v?: string) => new Headers(v === undefined ? {} : { "x-yaho-skill-key": v });
const now = new Date("2026-11-18T00:00:00Z");
const scopeEnv = { AI_SERVICE_SYNTHETIC_RUN_ID: "test-run-123", AI_SERVICE_SYNTHETIC_EXPIRES_AT: "2026-12-01T00:00:00Z" };
const payload = { bot: { id: "synthetic-bot" }, userRequest: { user: { id: "synthetic-test-run-123" }, block: { id: "synthetic-block" }, utterance: "야호 준비물을 알려 주세요" } };
function codeOf(fn: () => unknown) { try { fn(); throw new Error("expected rejection"); } catch (error) { expect(error).toBeInstanceOf(SkillDiagDenied); return (error as SkillDiagDenied).diagCode; } }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("diagnostic guard classification", () => {
    it.each([
        [C.S3_REG_PROD_MISSING, undefined, undefined, undefined], [C.S3_REG_PROD_LENGTH, "short", undefined, undefined],
        [C.S3_SUPPLIED_ABSENT, prod, undefined, undefined], [C.S3_SUPPLIED_EMPTY, prod, undefined, ""],
        [C.S3_SUPPLIED_TOO_LONG, prod, undefined, "x".repeat(257)], [C.S3_REG_TEST_LENGTH, prod, "bad", prod],
        [C.S3_REG_TEST_EQUALS_PROD, prod, prod, prod], [C.S3_MISMATCH, prod, test, "wrong"],
    ])("classifies %s", (code, p, t, supplied) => {
        expect(codeOf(() => authenticateSkill(headers(supplied), { prod: p, test: t }, "PREVIEW"))).toBe(code);
    });
    it("T-U-2 records test secret presence only for mismatch", () => {
        for (const [configured, expected] of [[test, true], [undefined, false]] as const) {
            try { authenticateSkill(headers("wrong"), { prod, test: configured }, "PREVIEW"); } catch (error) {
                expect(error).toMatchObject({ diagCode: C.S3_MISMATCH, testSecretConfigured: expected });
            }
        }
        expect(new SkillDiagDenied(C.S3_REG_PROD_MISSING, true).testSecretConfigured).toBeUndefined();
    });
    it.each([
        [C.S6_RUN_MISSING, {}, JSON.stringify(payload), now],
        [C.S6_RUN_FORMAT, { ...scopeEnv, AI_SERVICE_SYNTHETIC_RUN_ID: "!" }, JSON.stringify(payload), now],
        [C.S6_EXPIRY_MISSING, { ...scopeEnv, AI_SERVICE_SYNTHETIC_EXPIRES_AT: "" }, JSON.stringify(payload), now],
        [C.S6_EXPIRY_INVALID, { ...scopeEnv, AI_SERVICE_SYNTHETIC_EXPIRES_AT: "invalid" }, JSON.stringify(payload), now],
        [C.S6_CLOCK_INVALID, scopeEnv, JSON.stringify(payload), new Date(NaN)],
        [C.S6_EXPIRY_PASSED, scopeEnv, JSON.stringify(payload), new Date("2027-01-01")],
        [C.S6_BODY_JSON_INVALID, scopeEnv, "{", now], [C.S6_BODY_SCHEMA_INVALID, scopeEnv, "{}", now],
        [C.S6_BOT_MISMATCH, scopeEnv, JSON.stringify({ ...payload, bot: { id: "bad" } }), now],
        [C.S6_USER_MISMATCH, scopeEnv, JSON.stringify({ ...payload, userRequest: { ...payload.userRequest, user: { id: "bad" } } }), now],
        [C.S6_BLOCK_MISMATCH, scopeEnv, JSON.stringify({ ...payload, userRequest: { ...payload.userRequest, block: { id: "bad" } } }), now],
        [C.S6_UTTERANCE_UNKNOWN, scopeEnv, JSON.stringify({ ...payload, userRequest: { ...payload.userRequest, utterance: "bad" } }), now],
    ])("classifies %s", (code, env, body, clock) => expect(codeOf(() => validateSyntheticScope(body, env, clock))).toBe(code));
    it.each([[C.S7B_BOT_EMPTY, { botId: "" }], [C.S7B_USER_EMPTY, { userId: "" }], [C.S7B_UTTERANCE_EMPTY, { utterance: "" }], [C.S7B_CLOCK_INVALID, { now: new Date(NaN) }]])("classifies %s", (code, patch) => {
        expect(codeOf(() => deriveStableRequestId({ botId: "b", userId: "u", blockId: "", utterance: "u", now, ...patch }))).toBe(code);
    });
    it("classifies runtime, keys and scope guards", () => {
        expect(codeOf(() => assertSyntheticSkillEnabled({}))).toBe(C.S1_ENV_NOT_PREVIEW);
        expect(codeOf(() => assertSyntheticSkillEnabled({ VERCEL_ENV: "preview" }))).toBe(C.S1_GATE_OFF);
        expect(codeOf(() => readServiceKeys({ NODE_ENV: "test" }))).toBe(C.S8B_KEYS_ENC_PARSE);
        const key = Buffer.alloc(32, 1).toString("base64");
        const env = { NODE_ENV: "test" as const, AI_SERVICE_ENCRYPTION_KEYS: JSON.stringify({ v1: key }) };
        expect(codeOf(() => readServiceKeys(env))).toBe(C.S8B_KEYS_HMAC_PARSE);
        expect(codeOf(() => readServiceKeys({ ...env, AI_SERVICE_HMAC_KEYS: env.AI_SERVICE_ENCRYPTION_KEYS }))).toBe(C.S8B_KEYS_VALIDATE);
        expect(codeOf(() => assertSyntheticScope({} as never))).toBe(C.S8B_SCOPE_EXPIRED);
    });
    it.each([
        [C.S8B_REG_PROD_MISSING, undefined, undefined], [C.S8B_REG_PROD_LENGTH, "short", undefined],
        [C.S8B_REG_TEST_LENGTH, prod, "short"], [C.S8B_REG_TEST_EQUALS_PROD, prod, prod],
    ])("classifies factory %s", (code, operational, optionalTest) => {
        const env = { NODE_ENV: "test" as const, AI_SERVICE_ENCRYPTION_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 1).toString("base64") }),
            AI_SERVICE_HMAC_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 2).toString("base64") }), AI_SERVICE_ENCRYPTION_ACTIVE: "v1", AI_SERVICE_HMAC_ACTIVE: "v1",
            AI_SERVICE_SKILL_SECRET: operational, AI_SERVICE_SKILL_TEST_SECRET: optionalTest };
        expect(codeOf(() => createLiveDependencies({ env, db: fakeDb().db, environment: "PREVIEW", botId: "bot", scope: {} as never }))).toBe(code);
    });
    it("T-U-12 maps an unexpected conversion failure to S0_UNKNOWN inside keys", () => {
        const key = Buffer.alloc(32, 1).toString("base64");
        const env = { NODE_ENV: "test" as const, AI_SERVICE_ENCRYPTION_KEYS: JSON.stringify({ v1: key }), AI_SERVICE_HMAC_KEYS: JSON.stringify({ v1: key }) };
        vi.spyOn(Object, "fromEntries").mockImplementationOnce(() => { throw new Error("unexpected"); });
        try { readServiceKeys(env); } catch (error) { expect(error).toBeInstanceOf(ServiceDenied); expect(error).toMatchObject({ diagCode: C.S0_UNKNOWN, message: "AI_SERVICE_DENIED" }); }
    });
});

describe("diagnostic static boundaries", () => {
    it("restricts console and input reads to the fixed diagnostic sink", () => {
        const source = readFileSync("server/ai-service/skill-diag.ts", "utf8");
        expect(source).not.toMatch(/request\.text\(\)|headers\.get|process\.env\.AI_SERVICE_SKILL/);
        expect(source.match(/console\.(?:log|error|warn)\s*\(/g)).toEqual(["console.error("]);
        expect(source).toContain("console.error(JSON.stringify({ diag:");
        for (const file of ["app/api/ai-service/v1/skill/route.ts", "server/ai-service/transport.ts", "server/ai-service/runtime.ts", "server/ai-service/synthetic-scope.ts", "server/ai-service/request-id.ts", "server/ai-service/keys.ts", "server/ai-service/factory.ts"]) {
            expect(readFileSync(file, "utf8")).not.toMatch(/console\.(?:log|error|warn)\s*\(/);
        }
    });
});

describe("emission and retention", () => {
    it("writes allowed shape and strips mismatch flag for other codes", async () => {
        vi.stubEnv("VERCEL_ENV", "preview");
        const create = vi.fn().mockResolvedValue({});
        const db = { aiServiceSkillDiag: { create } } as unknown as Pick<PrismaClient, "aiServiceSkillDiag">;
        await emitSkillDiag({ code: C.S1_GATE_OFF, correlationId: "corr", testSecretConfigured: true }, { db });
        expect(create).toHaveBeenCalledOnce();
        expect(create.mock.calls[0][0].data).toMatchObject({ correlationId: "corr", environment: "PREVIEW", stageCode: C.S1_GATE_OFF, testSecretConfigured: null, diagVersion: 1 });
    });
    it("T-U-7 falls back on DB failure, swallows console failures and cleans timeout", async () => {
        vi.stubEnv("VERCEL_ENV", "preview"); vi.useFakeTimers();
        const create = vi.fn().mockRejectedValue(new Error("secret must not be logged"));
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const db = { aiServiceSkillDiag: { create } } as unknown as Pick<PrismaClient, "aiServiceSkillDiag">;
        await expect(emitSkillDiag({ code: C.S1_GATE_OFF, correlationId: "corr" }, { db })).resolves.toBeUndefined();
        expect(JSON.parse(log.mock.calls[0][0])).toEqual({ diag: "yaho-skill-v1", v: 1, code: C.S1_GATE_OFF, corr: "corr", dep: null, env: "preview", ts: expect.any(String) });
        expect(vi.getTimerCount()).toBe(0);
        log.mockImplementation(() => { throw new Error("log failure"); });
        await expect(emitSkillDiag({ code: C.S1_GATE_OFF, correlationId: "corr" }, { db })).resolves.toBeUndefined();
    });
    it("times out and swallows late rejection", async () => {
        vi.stubEnv("VERCEL_ENV", "preview"); vi.useFakeTimers();
        let reject!: (reason?: unknown) => void;
        const create = vi.fn(() => new Promise((_, r) => { reject = r; }));
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const db = { aiServiceSkillDiag: { create } } as unknown as Pick<PrismaClient, "aiServiceSkillDiag">;
        const result = emitSkillDiag({ code: C.S1_GATE_OFF, correlationId: "corr" }, { db });
        await vi.advanceTimersByTimeAsync(3000); await result; reject(new Error("late")); await Promise.resolve();
        expect(log).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    });
    it("T-PROD-1 emits nothing outside preview", async () => {
        vi.stubEnv("VERCEL_ENV", "production"); const create = vi.fn(); const log = vi.spyOn(console, "error");
        await emitSkillDiag({ code: C.S1_GATE_OFF, correlationId: "corr" }, { db: { aiServiceSkillDiag: { create } } as unknown as Pick<PrismaClient, "aiServiceSkillDiag"> });
        expect(create).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
    });
    it("T-U-11 purges batches at the 90-day cutoff within environment", async () => {
        const f = fakeDb(), cutoff = new Date(+now - 90 * 86400000);
        for (let i = 0; i < 205; i++) f.seed("aiServiceSkillDiag", { id: `old-${i}`, environment: "PREVIEW", emittedAt: cutoff });
        f.seed("aiServiceSkillDiag", { id: "live", environment: "PREVIEW", emittedAt: new Date(+cutoff + 1) });
        f.seed("aiServiceSkillDiag", { id: "other", environment: "PRODUCTION", emittedAt: cutoff });
        expect(await purgeOldSkillDiag(f.db, "PREVIEW", now)).toEqual({ diagDeleted: 205 });
        expect(f.state.aiServiceSkillDiag.map(r => r.id)).toEqual(["live", "other"]);
        expect(f.operations.filter(op => op === "aiServiceSkillDiag.deleteMany")).toHaveLength(3);
    });
});
