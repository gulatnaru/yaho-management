import { afterEach, describe, expect, it, vi } from "vitest";
import { skillHandoffCard, skillReply, type Environment } from "@/server/ai-service/contracts";
import { handleSkill, type Dependencies } from "@/server/ai-service/handler";
import { testProvider, type ProviderResult } from "@/server/ai-service/provider";
import { handleKakaoSkill } from "@/server/ai-service/skill";
import { createTools } from "@/server/ai-service/tools";
import { fakeDb, now, seedConfig } from "./fake-db";
import { realRequestPayload, type RealRequestPayload } from "./real-request-fixture";

const prodSecret = "synthetic-prod-secret-0123456789abcdef";
const testSecret = "synthetic-test-secret-0123456789abcdef";
const syntheticRouteSecret = "synthetic-synthetic-route-secret-0123456789abcdef";
const requestId = "synthetic-auth-request-001";
const guidance = "합성 준비물은 모자입니다.";

function setup(result: ProviderResult = {
    call: { name: "get_approved_guidance", args: { topic: "PREPARATION" } },
    usage: { inputTokens: 100, outputTokens: 10 },
}, environment: Environment = "PREVIEW", testSecretValue: string | undefined = testSecret) {
    const f = fakeDb();
    seedConfig(f, environment);
    f.seed("aiServiceKnowledgeEntry", { environment, topic: "PREPARATION", approved: true, content: guidance });
    const provider = testProvider(result);
    const classify = vi.fn(provider.classify);
    const tools = createTools(f.db, environment, () => now);
    const execute = vi.fn(tools.execute);
    const deps: Dependencies = {
        db: f.db, environment, secret: prodSecret, testSecret: testSecretValue, botId: "synthetic-bot", clock: () => now,
        keys: { encryption: { v1: Buffer.alloc(32, 1) }, hmac: { v1: Buffer.alloc(32, 2) }, activeEncryption: "v1", activeHmac: "v1" },
        provider: () => ({ id: "TEST_DOUBLE", classify }), tools: { execute },
    };
    const headersFor = (value: string | undefined) => new Headers(value === undefined ? {} : { "x-yaho-skill-key": value });
    const run = (body: unknown = realRequestPayload(), headers: Headers = headersFor(prodSecret), id = requestId) =>
        handleKakaoSkill(headers, JSON.stringify(body), id, deps);
    const runWithService = async (body: unknown, headers: Headers) => {
        const service = vi.fn(handleSkill);
        const reply = await handleKakaoSkill(headers, JSON.stringify(body), requestId, deps, service);
        return { reply, service };
    };
    return { f, deps, classify, headersFor, run, runWithService };
}
function withSurface(surface: string | undefined) {
    const next = realRequestPayload();
    next.userRequest.params = (surface === undefined ? {} : { surface }) as RealRequestPayload["userRequest"]["params"];
    return next;
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Skill auth matrix (prod/test secrets, surface is never an auth signal)", () => {
    it("A-1 allows the prod secret in PREVIEW", async () => {
        const { run, f, classify } = setup();
        expect(await run()).toEqual(skillReply(guidance));
        expect(classify).toHaveBeenCalledTimes(1);
        expect(f.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", usedKrw: 1 });
    });

    it("A-2 allows the test secret in PREVIEW", async () => {
        const { run, classify } = setup();
        expect(await run(realRequestPayload(), new Headers({ "x-yaho-skill-key": testSecret }))).toEqual(skillReply(guidance));
        expect(classify).toHaveBeenCalledTimes(1);
    });

    it("A-3 rejects the test secret in PRODUCTION", async () => {
        const { runWithService, f, classify } = setup(undefined, "PRODUCTION");
        const { reply, service } = await runWithService(realRequestPayload(), new Headers({ "x-yaho-skill-key": testSecret }));
        expect(reply).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
        expect(classify).not.toHaveBeenCalled();
        expect(f.operations).toHaveLength(0);
    });

    it("A-4 allows the prod secret in PRODUCTION", async () => {
        const { run, classify } = setup(undefined, "PRODUCTION");
        expect(await run()).toEqual(skillReply(guidance));
        expect(classify).toHaveBeenCalledTimes(1);
    });

    it.each(["PREVIEW", "PRODUCTION"] as const)("A-5 rejects a wrong secret in %s", async environment => {
        const { runWithService, f, classify } = setup(undefined, environment);
        const { reply, service } = await runWithService(realRequestPayload(), new Headers({ "x-yaho-skill-key": "synthetic-wrong-secret-0123456789abcdef" }));
        expect(reply).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
        expect(classify).not.toHaveBeenCalled();
        expect(f.operations).toHaveLength(0);
    });

    it.each(["PREVIEW", "PRODUCTION"] as const)("A-6 rejects a missing header in %s", async environment => {
        const { runWithService, f, classify } = setup(undefined, environment);
        const { reply, service } = await runWithService(realRequestPayload(), new Headers());
        expect(reply).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
        expect(classify).not.toHaveBeenCalled();
        expect(f.operations).toHaveLength(0);
    });

    it("A-7 rejects a 257-char header", async () => {
        const { runWithService, f } = setup();
        const { reply, service } = await runWithService(realRequestPayload(), new Headers({ "x-yaho-skill-key": "x".repeat(257) }));
        expect(reply).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
        expect(f.operations).toHaveLength(0);
    });

    it("A-8 rejects a test header when no test secret is configured", async () => {
        // Do not pass undefined through setup()'s third parameter: an explicit
        // undefined triggers its default (the test secret). Override instead.
        const { runWithService, f, deps } = setup();
        deps.testSecret = undefined;
        const { reply, service } = await runWithService(realRequestPayload(), new Headers({ "x-yaho-skill-key": testSecret }));
        expect(reply).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
        expect(f.operations).toHaveLength(0);
    });

    it("A-10 allows BuilderBotTest surface with the prod secret (surface does not demote)", async () => {
        const { run } = setup();
        expect(await run(withSurface("BuilderBotTest"))).toEqual(skillReply(guidance));
    });

    it("A-11 allows Kakaotalk.plusfriend surface with the test secret (surface does not promote)", async () => {
        const { run } = setup();
        expect(await run(withSurface("Kakaotalk.plusfriend"), new Headers({ "x-yaho-skill-key": testSecret }))).toEqual(skillReply(guidance));
    });

    it("A-12 rejects BuilderBotTest surface with the test secret in PRODUCTION", async () => {
        const { runWithService, f } = setup(undefined, "PRODUCTION");
        const { reply, service } = await runWithService(withSurface("BuilderBotTest"), new Headers({ "x-yaho-skill-key": testSecret }));
        expect(reply).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
        expect(f.operations).toHaveLength(0);
    });

    it("A-13 rejects Kakaotalk.plusfriend surface with the test secret in PRODUCTION", async () => {
        const { runWithService, f } = setup(undefined, "PRODUCTION");
        const { reply, service } = await runWithService(withSurface("Kakaotalk.plusfriend"), new Headers({ "x-yaho-skill-key": testSecret }));
        expect(reply).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
        expect(f.operations).toHaveLength(0);
    });

    it("A-14 rejects BuilderBotTest surface with a wrong secret", async () => {
        const { runWithService, f } = setup();
        const { reply, service } = await runWithService(withSurface("BuilderBotTest"), new Headers({ "x-yaho-skill-key": "synthetic-wrong-secret-0123456789abcdef" }));
        expect(reply).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
        expect(f.operations).toHaveLength(0);
    });

    it("A-15 allows a missing surface with the prod secret", async () => {
        const { run } = setup();
        expect(await run(withSurface(undefined))).toEqual(skillReply(guidance));
    });

    it("A-16 rejects the synthetic-route secret on the real route", async () => {
        const { runWithService, f } = setup();
        const { reply, service } = await runWithService(realRequestPayload(), new Headers({ "x-yaho-skill-key": syntheticRouteSecret }));
        expect(reply).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
        expect(f.operations).toHaveLength(0);
    });

    it("A-17 rejects a weak prod secret even when the header matches it", async () => {
        const { deps, f, classify } = setup();
        deps.secret = "x".repeat(31);
        const service = vi.fn(handleSkill);
        const reply = await handleKakaoSkill(new Headers({ "x-yaho-skill-key": "x".repeat(31) }), JSON.stringify(realRequestPayload()), requestId, deps, service);
        expect(reply).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
        expect(classify).not.toHaveBeenCalled();
        expect(f.operations).toHaveLength(0);
    });

    it("A-18 rejects a weak test secret even when the header matches it", async () => {
        const { deps, f, classify } = setup(undefined, "PREVIEW", "x".repeat(31));
        const service = vi.fn(handleSkill);
        const reply = await handleKakaoSkill(new Headers({ "x-yaho-skill-key": "x".repeat(31) }), JSON.stringify(realRequestPayload()), requestId, deps, service);
        expect(reply).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
        expect(classify).not.toHaveBeenCalled();
        expect(f.operations).toHaveLength(0);
    });
});
