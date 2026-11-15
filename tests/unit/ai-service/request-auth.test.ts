import { describe, expect, it, vi } from "vitest";
import { authenticateSkillContext, verifiedSkillKind, type VerifiedSkillAuth } from "@/server/ai-service/transport";
import { handleKakaoSkill, type SkillService } from "@/server/ai-service/skill";
import { skillHandoffCard } from "@/server/ai-service/contracts";
import type { Dependencies } from "@/server/ai-service/handler";
import { fakeDb, now } from "./fake-db";
import { realRequestPayload } from "./real-request-fixture";

const prod = "synthetic-auth-prod-secret-0123456789abcdef";
const test = "synthetic-auth-test-secret-0123456789abcdef";
const headers = (key: string) => new Headers({ "x-yaho-skill-key": key });
function deps(): Dependencies {
    return { db: fakeDb().db, environment: "PREVIEW", secret: prod, testSecret: test, botId: "synthetic-bot", clock: () => now,
        keys: { encryption: { v1: Buffer.alloc(32, 1) }, hmac: { v1: Buffer.alloc(32, 2) }, activeEncryption: "v1", activeHmac: "v1" },
        tools: { execute: vi.fn() } };
}

describe("server-issued request authentication", () => {
    it.each([[prod, "prod"], [test, "test"]] as const)("retains the kind determined by the authenticated secret", (secret, kind) => {
        expect(verifiedSkillKind(authenticateSkillContext(headers(secret), { prod, test }, "PREVIEW"), "PREVIEW")).toBe(kind);
    });
    it.each([undefined, null, "test", {}, Object.freeze({})])("rejects missing or forged context", value => {
        expect(() => verifiedSkillKind(value, "PREVIEW")).toThrow("AI_SERVICE_DENIED");
    });
    it("rejects evidence issued for another environment", () => {
        const context = authenticateSkillContext(headers(prod), { prod, test }, "PREVIEW");
        expect(() => verifiedSkillKind(context, "PRODUCTION")).toThrow("AI_SERVICE_DENIED");
    });
    it("rejects direct adapter calls without context before calling the service", async () => {
        const service = vi.fn();
        const result = await handleKakaoSkill(headers(test), JSON.stringify(realRequestPayload()), "synthetic-request-1234", deps(), service);
        expect(result).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
    });
    it("rejects a forged context before calling the service", async () => {
        const service = vi.fn();
        const result = await handleKakaoSkill(headers(test), JSON.stringify(realRequestPayload()), "synthetic-request-1234", deps(), service, {} as VerifiedSkillAuth);
        expect(result).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
    });
    it("passes the same issued context through to the service", async () => {
        const context = authenticateSkillContext(headers(test), { prod, test }, "PREVIEW");
        const service = vi.fn<SkillService>(async () => ({ version: "2.0", template: { outputs: [{ simpleText: { text: "안내" } }] } }));
        await handleKakaoSkill(headers(test), JSON.stringify(realRequestPayload()), "synthetic-request-1234", deps(), service, context);
        expect(service).toHaveBeenCalledOnce();
        expect(service.mock.calls[0][4]).toBe(context);
    });
});
