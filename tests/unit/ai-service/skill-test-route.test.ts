import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ai-service/v1/skill-test/route";
import { POST as productionSkill } from "@/app/api/ai-service/v1/skill/route";
import { GET as retentionGet, POST as retentionPost } from "@/app/api/ai-service/v1/retention/route";
import { skillReply } from "@/server/ai-service/contracts";

const secret = "synthetic-test-route-secret-0123456789";
function request(body: unknown = { synthetic: true, scenario: "PROGRAMS" }, key: string | null = secret) {
    return new Request("http://localhost/api/ai-service/v1/skill-test", {
        method: "POST", body: JSON.stringify(body),
        headers: { "content-type": "application/json", ...(key === null ? {} : { "x-yaho-skill-key": key }) },
    });
}
beforeEach(() => {
    vi.stubEnv("AI_SERVICE_TEST_SKILL_SECRET", secret);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("closed synthetic Skill test route", () => {
    it("uses a fixed test double and fixture with zero network calls or echoed input", async () => {
        const response = await POST(request());
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(skillReply("합성 테스트 프로그램"));
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each(["POLICY", "PREPARATION", "RAIN", "HANDOFF"])("hands off %s without inventing official guidance", async scenario => {
        const response = await POST(request({ synthetic: true, scenario }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(skillReply());
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([null, "wrong"])("authenticates before reading the body: %s", async key => {
        const input = request(undefined, key);
        const read = vi.spyOn(input, "body", "get");
        expect((await POST(input)).status).toBe(401);
        expect(read).not.toHaveBeenCalled();
        expect(input.bodyUsed).toBe(false);
    });

    it.each(["", "weak", "x".repeat(257)])("fails closed without a strong test-specific secret", async value => {
        vi.stubEnv("AI_SERVICE_TEST_SKILL_SECRET", value);
        vi.stubEnv("AI_SERVICE_SKILL_SECRET", secret);
        const input = request();
        expect((await POST(input)).status).toBe(503);
        expect(input.bodyUsed).toBe(false);
    });

    it("blocks production before authentication or body processing", async () => {
        vi.stubEnv("VERCEL_ENV", "production");
        const input = request();
        expect((await POST(input)).status).toBe(503);
        expect(input.bodyUsed).toBe(false);
    });

    it.each([
        { version: "2.0", bot: { id: "real-bot" }, userRequest: { utterance: "준비물", user: { id: "real-user" } }, action: {} },
        { synthetic: false, scenario: "PROGRAMS" },
        { synthetic: true, scenario: "unknown" },
        { synthetic: true, scenario: "PROGRAMS", userId: "synthetic-but-arbitrary" },
        { synthetic: true, scenario: "PROGRAMS", bot: { id: "synthetic-bot" } },
        { synthetic: true, scenario: "PROGRAMS", callbackUrl: "https://synthetic.invalid" },
        ...["991231-1234567", "010-0000-0000", "synthetic@example.invalid", "홍합성 아이의 예약을 취소해 주세요"].map(utterance => ({ synthetic: true, scenario: "PROGRAMS", utterance })),
    ])("rejects ordinary envelopes, arbitrary identifiers and private/free text %#", async body => {
        const response = await POST(request(body));
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(skillReply());
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each(["{", "null", "[]", '"synthetic"'])("rejects malformed JSON/schema %s", async body => {
        const input = new Request(request(), { body });
        const response = await POST(input);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(skillReply());
    });

    it("requires JSON and rejects oversized UTF-8 bodies even when content-length lies", async () => {
        const nonJson = request(); nonJson.headers.set("content-type", "text/plain");
        expect((await POST(nonJson)).status).toBe(400);
        expect(nonJson.bodyUsed).toBe(false);
        const large = request({ synthetic: true, scenario: "PROGRAMS", extra: "한".repeat(6000) });
        large.headers.set("content-length", "1");
        expect((await POST(large)).status).toBe(400);
    });

    it("accepts exactly 16KiB, rejects one extra byte and malformed UTF-8", async () => {
        const body = JSON.stringify({ synthetic: true, scenario: "PROGRAMS" }).padEnd(16384, " ");
        expect((await POST(new Request(request(), { body }))).status).toBe(200);
        expect((await POST(new Request(request(), { body: body + " " }))).status).toBe(400);
        expect((await POST(new Request(request(), { body: new Uint8Array([0xff]) }))).status).toBe(400);
    });

    it("bounds an unfinished request body without creating a provider or making network calls", async () => {
        vi.useFakeTimers();
        const cancel = vi.fn();
        const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"synthetic":')); }, cancel });
        const input = new Request("http://localhost", { method: "POST", body: stream, duplex: "half",
            headers: { "content-type": "application/json", "x-yaho-skill-key": secret } } as RequestInit);
        const pending = POST(input);
        await vi.advanceTimersByTimeAsync(3500);
        expect((await pending).status).toBe(400);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(fetch).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("rejects oversize streams even if underlying cancellation never completes", async () => {
        const stream = new ReadableStream({
            start(controller) { controller.enqueue(new Uint8Array(16385)); },
            cancel() { return new Promise<void>(() => {}); },
        });
        const input = new Request("http://localhost", { method: "POST", body: stream, duplex: "half",
            headers: { "content-type": "application/json", "x-yaho-skill-key": secret } } as RequestInit);
        expect((await POST(input)).status).toBe(400);
    });

    it("keeps real Skill and retention ingress locked even with a valid synthetic secret", async () => {
        for (const route of [productionSkill, retentionGet, retentionPost]) {
            const response = await route();
            expect(response.status).toBe(503);
            expect(response.headers.get("cache-control")).toBe("no-store");
            expect(await response.json()).toEqual(skillReply());
        }
        expect(fetch).not.toHaveBeenCalled();
    });
});
