import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as publicSkill } from "@/app/api/ai-service/v1/skill/route";
import { HANDOFF, HANDOFF_CARD_BUTTON_LABEL, HANDOFF_CARD_TITLE, skillCardReplySchema, skillHandoffCard, skillReply } from "@/server/ai-service/contracts";
import { hashes } from "@/server/ai-service/crypto";
import { handleSkill, type Dependencies } from "@/server/ai-service/handler";
import { handleKakaoSkill, type SkillService } from "@/server/ai-service/skill";
import { createTools } from "@/server/ai-service/tools";
import { fakeDb, now, seedConfig } from "./fake-db";
import { realRequestPayload } from "./real-request-fixture";

const secret = "synthetic-skill-secret-0123456789abcdef";
const requestId = "synthetic-skill-request-001";
const guidance = "합성 준비물은 모자입니다.";
const headers = () => new Headers({ "x-yaho-skill-key": secret });
// Full real Kakao SkillPayload shape (official answer_json_format): no top-level
// `version` key — it is a response-only field. intent/flow/contexts/block/
// properties/params/lang/timezone ride along as passthrough and are ignored.
// The JSON lives in ./real-request-fixture so unit, auth and integration tests
// can never drift apart on the real-request shape.
function payload() {
    return realRequestPayload();
}
function setup() {
    const f = fakeDb();
    seedConfig(f);
    f.seed("aiServiceKnowledgeEntry", { environment: "PREVIEW", topic: "PREPARATION", approved: true, content: guidance });
    const tools = createTools(f.db, "PREVIEW", () => now);
    const execute = vi.fn(tools.execute);
    const deps: Dependencies = {
        db: f.db, environment: "PREVIEW", secret, botId: "synthetic-bot", clock: () => now,
        keys: { encryption: { v1: Buffer.alloc(32, 1) }, hmac: { v1: Buffer.alloc(32, 2) }, activeEncryption: "v1", activeHmac: "v1" },
        tools: { execute },
    };
    const run = (body: unknown = payload(), id = requestId) => handleKakaoSkill(headers(), JSON.stringify(body), id, deps);
    return { f, deps, execute, run };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("synthetic internal Kakao Skill v2 adapter", () => {
    it("accepts clientExtra:null and integrates real tools, HMAC ledger, encryption and known billing", async () => {
        const { run, f, deps } = setup();
        expect(await run()).toEqual(skillReply(guidance));
        const row = f.state.aiServiceRequest[0];
        expect(row).toMatchObject({ status: "SETTLED", usedKrw: 0, category: "GUIDANCE" });
        expect(row.requestHashes).toEqual(hashes(deps.keys, "request", "PREVIEW", requestId));
        expect(row.subjectHashes).toEqual(hashes(deps.keys, "subject", "PREVIEW", payload().userRequest.user.id));
        expect(row.payloadHash).toBe(hashes(deps.keys, "payload", "PREVIEW", payload().userRequest.utterance)[0]);
        expect(row.requestKey).not.toContain(createHash("sha256").update(requestId).digest("hex"));
        expect(JSON.stringify(f.state)).not.toContain(payload().userRequest.user.id);
        expect(JSON.stringify(row)).not.toContain(payload().userRequest.utterance);
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 0, reservedKrw: 0 });
    });

    it.each([undefined, {}, { synthetic: true }])("also accepts omitted/object clientExtra: %j", async value => {
        const { run } = setup();
        const body = payload(); body.action.clientExtra = value;
        expect(await run(body)).toEqual(skillReply(guidance));
    });

    it.each([undefined, "wrong", "x".repeat(257)])("authenticates before parsing or dispatch: %j", async supplied => {
        const { deps, f } = setup();
        const parse = vi.spyOn(JSON, "parse");
        const service = vi.fn(handleSkill);
        const h = new Headers(supplied === undefined ? {} : { "x-yaho-skill-key": supplied });
        expect(await handleKakaoSkill(h, "invalid-json", requestId, deps, service)).toEqual(skillHandoffCard());
        expect(parse).not.toHaveBeenCalled();
        expect(service).not.toHaveBeenCalled();
        expect(f.operations).toHaveLength(0);
    });

    it.each(["", "short", "x".repeat(257)])("fails closed for missing/weak configured secret", async configured => {
        const { deps, f } = setup(); deps.secret = configured;
        expect(await handleKakaoSkill(headers(), JSON.stringify(payload()), requestId, deps)).toEqual(skillHandoffCard());
        expect(f.operations).toHaveLength(0);
    });

    it.each([
        ["unsupported version", (p: ReturnType<typeof payload>) => ({ ...p, version: "1.0" })],
        ["version 2.1", (p: ReturnType<typeof payload>) => ({ ...p, version: "2.1" })],
        ["empty version", (p: ReturnType<typeof payload>) => ({ ...p, version: "" })],
        ["null version", (p: ReturnType<typeof payload>) => ({ ...p, version: null })],
        ["numeric version", (p: ReturnType<typeof payload>) => ({ ...p, version: 2 })],
        ["array version", (p: ReturnType<typeof payload>) => ({ ...p, version: ["2.0"] })],
        ["wrong bot", (p: ReturnType<typeof payload>) => ({ ...p, bot: { id: "another-bot" } })],
        ["callback", (p: ReturnType<typeof payload>) => ({ ...p, userRequest: { ...p.userRequest, callbackUrl: "https://synthetic.invalid/callback" } })],
        ["null callback", (p: ReturnType<typeof payload>) => ({ ...p, userRequest: { ...p.userRequest, callbackUrl: null } })],
        ["empty utterance", (p: ReturnType<typeof payload>) => ({ ...p, userRequest: { ...p.userRequest, utterance: "  \n " } })],
        ["long utterance", (p: ReturnType<typeof payload>) => ({ ...p, userRequest: { ...p.userRequest, utterance: "야".repeat(1001) } })],
        ["nontext utterance", (p: ReturnType<typeof payload>) => ({ ...p, userRequest: { ...p.userRequest, utterance: 123 } })],
        ["unbounded subject", (p: ReturnType<typeof payload>) => ({ ...p, userRequest: { ...p.userRequest, user: { id: "s".repeat(129) } } })],
        ["invalid action", (p: ReturnType<typeof payload>) => ({ ...p, action: { ...p.action, id: "bad action" } })],
        ["invalid clientExtra", (p: ReturnType<typeof payload>) => ({ ...p, action: { ...p.action, clientExtra: [] } })],
    ] as const)("rejects %s before DB/service", async (_, change) => {
        const { deps, f } = setup();
        const service = vi.fn(handleSkill);
        expect(await handleKakaoSkill(headers(), JSON.stringify(change(payload())), requestId, deps, service)).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
        expect(f.operations).toHaveLength(0);
    });

    it.each(["{", "null", "[]", "true"])("rejects malformed envelope %s", async raw => {
        const { deps, f } = setup();
        expect(await handleKakaoSkill(headers(), raw, requestId, deps)).toEqual(skillHandoffCard());
        expect(f.operations).toHaveLength(0);
    });

    it.each([
        ["reported RRN regression", "야호 예약 991231-1234567"],
        ["compact RRN", "야호 예약 9912311234567"],
        ["space-separated RRN", "야호 예약 991231 1234567"],
        ["RRN without a valid checksum", "야호 예약 991231-1234560"],
        ["mobile phone", "야호 예약 010-0000-0000"],
        ["compact mobile phone", "야호 예약 01000000000"],
        ["space-separated mobile phone", "야호 예약 010 0000 0000"],
        ["dot-separated mobile phone", "야호 예약 010.0000.0000"],
        ["landline phone", "야호 예약 02-000-0000"],
        ["international mobile phone", "야호 예약 +82 10 0000 0000"],
        ["email", "야호 예약 synthetic@example.invalid"],
        ["email with tag and subdomain", "야호 예약 SYNTHETIC+tag@sub.example.invalid"],
        ["fullwidth RRN", "야호 예약 ９９１２３１－１２３４５６７"],
        ["invisible separators in phone", "야호 예약 010\u200b-0000-0000"],
        ["fullwidth email", "야호 예약 ｓｙｎｔｈｅｔｉｃ＠ｅｘａｍｐｌｅ．ｉｎｖａｌｉｄ"],
    ])("rejects %s during validation before service or DB access", async (_, utterance) => {
        const { deps, f, execute } = setup();
        const body = payload(); body.userRequest.utterance = utterance;
        const service = vi.fn(handleSkill);
        const transaction = vi.spyOn(f.db, "$transaction");
        const dbAccess = vi.fn(() => f.db);
        Object.defineProperty(deps, "db", { get: dbAccess });

        expect(await handleKakaoSkill(headers(), JSON.stringify(body), requestId, deps, service)).toEqual(skillHandoffCard());
        expect(service).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        expect(dbAccess).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
        expect(f.operations).toHaveLength(0);
    });

    it.each([
        ["birthdate with context", "야호 생년월일 1990년 5월 3일 알려 주세요"],
        ["birth year with context", "야호 1990년생입니다"],
        ["health keyword", "야호 알레르기 약을 추천해 주세요"],
    ])("rejects %s at layer 1 before any DB access", async (_, utterance) => {
        const { deps, f } = setup();
        const body = payload(); body.userRequest.utterance = utterance;
        expect(await handleKakaoSkill(headers(), JSON.stringify(body), requestId, deps)).toEqual(skillHandoffCard());
        expect(f.operations).toHaveLength(0);
    });

    it.each([
        "야호 예약 안내를 알려 주세요",
        "야호 2026-10-18 프로그램 준비물을 알려 주세요",
        "야호 2026년 10월 18일 10:00 일정 준비물을 알려 주세요",
        "야호 20261018 준비물을 알려 주세요",
    ])("passes ordinary reservation/date utterances through layer 1, then hands off deterministically: %s", async utterance => {
        const { run, f } = setup();
        const body = payload(); body.userRequest.utterance = utterance;
        expect(await run(body)).toEqual(skillHandoffCard());
        // A SETTLED row proves the utterance passed the PII filter and was
        // decided by the handler (decideSelection -> null), not rejected early.
        expect(f.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", usedKrw: 0 });
    });

    it("enforces 16KiB in UTF-8 bytes, accepting the exact boundary", async () => {
        const { run, deps, f } = setup();
        const body = { ...payload(), metadata: "" };
        body.metadata = "x".repeat(16384 - Buffer.byteLength(JSON.stringify(body)));
        expect(Buffer.byteLength(JSON.stringify(body))).toBe(16384);
        expect(await run(body)).toEqual(skillReply(guidance));
        const count = f.operations.length;
        expect(await handleKakaoSkill(headers(), JSON.stringify({ ...body, metadata: body.metadata + "x" }), requestId, deps)).toEqual(skillHandoffCard());
        const multibyte = JSON.stringify({ ...payload(), metadata: "한".repeat(5500) });
        expect(multibyte.length).toBeLessThan(16384);
        expect(await handleKakaoSkill(headers(), multibyte, requestId, deps)).toEqual(skillHandoffCard());
        expect(f.operations).toHaveLength(count);
    });

    it("accepts and trims a 1000-character utterance at the boundary", async () => {
        const { run } = setup();
        const body = payload(); body.userRequest.utterance = "야호 준비물".padEnd(1000, " ");
        expect(await run(body)).toEqual(skillReply(guidance));
    });

    it.each(["", "short", "x".repeat(129), "synthetic-request space"])("requires explicit bounded stable identity %j", async id => {
        const { run, f } = setup(); expect(await run(payload(), id)).toEqual(skillHandoffCard()); expect(f.operations).toHaveLength(0);
    });

    it.each(["unchanged", "utterance", "subject", "action", "metadata"])("refuses repeated identity with %s body, without redispatch or extra cost", async change => {
        const { run, f } = setup();
        expect(await run()).toEqual(skillReply(guidance));
        const body = payload();
        if (change === "utterance") body.userRequest.utterance = "야호 우천 안내";
        if (change === "subject") body.userRequest.user.id = "synthetic-another-subject";
        if (change === "action") body.action.id = "synthetic-another-action";
        if (change === "metadata") body.action.clientExtra = { retry: "synthetic-second-delivery" };
        expect(await run(body)).toEqual(skillHandoffCard());
        expect(f.state.aiServiceRequest).toHaveLength(1);
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 0, reservedKrw: 0 });
    });

    it("concurrent duplicates share one durable claim and one deterministic dispatch", async () => {
        const { run, f } = setup();
        const replies = await Promise.all([run(), run(), run()]);
        const simpleTextOf = (reply: unknown) => (reply as { template: { outputs: Array<{ simpleText?: { text: string } }> } }).template.outputs[0].simpleText?.text;
        const isCard = (reply: unknown) => "textCard" in ((reply as { template: { outputs: Array<Record<string, unknown>> } }).template.outputs[0]);
        expect(replies.filter(r => simpleTextOf(r) === guidance)).toHaveLength(1);
        expect(replies.filter(isCard)).toHaveLength(2);
        expect(f.state.aiServiceRequest).toHaveLength(1);
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 0, reservedKrw: 0 });
    });

    it("keeps deduplication across HMAC rotation, but permits intentional repeats with distinct identities", async () => {
        const { run, deps, f } = setup();
        await run();
        deps.keys.hmac.v2 = Buffer.alloc(32, 3); deps.keys.activeHmac = "v2";
        expect(await run()).toEqual(skillHandoffCard());
        expect(f.state.aiServiceRequest).toHaveLength(1);
        expect(await run(payload(), "synthetic-skill-request-002")).toEqual(skillReply(guidance));
        expect(f.state.aiServiceRequest).toHaveLength(2);
    });

    it.each([
        "야호 준비물과 우천 안내",
        "야호 운영정책에 결제 안내",
    ])("maps internal handoff/invalid selection to fixed safe Skill text: %s", async utterance => {
        const { run, f } = setup();
        const body = payload(); body.userRequest.utterance = utterance;
        expect(await run(body)).toEqual(skillHandoffCard());
        expect(f.state.aiServiceRequest[0].status).toBe("SETTLED");
        expect(f.state.aiServiceBudgetMonth[0].usedKrw).toBe(0);
    });

    it("never leaks service errors and keeps unknown dispatched cost reserved on a stuck tool", async () => {
        vi.useFakeTimers();
        try {
            const { run, execute, f } = setup();
            execute.mockImplementation(async call => {
                if (call.name === "get_approved_guidance") return new Promise(() => {});
                if (call.name === "list_public_programs") return { kind: "PROGRAMS", items: [] };
                return { kind: "CLASSES", items: [] };
            });
            const response = run(); await vi.advanceTimersByTimeAsync(201);
            expect(await response).toEqual(skillHandoffCard());
            expect(f.state.aiServiceRequest[0].status).toBe("UNKNOWN");
            expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ reservedKrw: 2, unknownCount: 1 });
        } finally { vi.useRealTimers(); }
    });

    it.each([
        undefined, { classification: "HUMAN_HANDOFF", error: "SYNTHETIC_PRIVATE_ERROR" },
        skillReply("HUMAN_HANDOFF"), skillReply(""), skillReply("x".repeat(1001)),
        { ...skillReply(guidance), internal: "SYNTHETIC_PRIVATE_ERROR" },
        { version: "2.0", template: { outputs: [{ simpleText: { text: guidance, error: "private" } }] } },
    ])("rebuilds only the trusted simpleText contract, failing closed for malformed replies %#", async result => {
        const { deps } = setup();
        expect(await handleKakaoSkill(headers(), JSON.stringify(payload()), requestId, deps, async () => result)).toEqual(skillHandoffCard());
    });

    it("normalizes only core fields and passes the stable identity unchanged", async () => {
        const { deps } = setup();
        const service = vi.fn<SkillService>(async () => skillReply(guidance));
        const body = { ...payload(), metadata: "SYNTHETIC_IGNORED_METADATA" };
        expect(await handleKakaoSkill(headers(), JSON.stringify(body), requestId, deps, service)).toEqual(skillReply(guidance));
        expect(service.mock.calls[0][2]).toBe(requestId);
        expect(JSON.parse(service.mock.calls[0][1])).toEqual({ bot: { id: "synthetic-bot" },
            userRequest: { utterance: "야호 준비물을 알려 주세요", user: { id: "synthetic-subject" } },
            action: { id: "synthetic-action", name: "synthetic" } });
    });

    it("clears timers on normal completion and synchronous delegate errors", async () => {
        vi.useFakeTimers(); const { run, deps } = setup();
        expect(await run()).toEqual(skillReply(guidance));
        expect(vi.getTimerCount()).toBe(0);
        expect(await handleKakaoSkill(headers(), JSON.stringify(payload()), requestId, deps, () => { throw new Error("SYNTHETIC_PRIVATE_ERROR"); })).toEqual(skillHandoffCard());
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(["resolve", "reject"] as const)("returns by four seconds for a hung delegate and consumes late %s", async completion => {
        vi.useFakeTimers(); const { deps } = setup();
        const pending = deferred<unknown>();
        let returned = false;
        const response = handleKakaoSkill(headers(), JSON.stringify(payload()), requestId, deps, () => pending.promise).then(value => { returned = true; return value; });
        await vi.advanceTimersByTimeAsync(3999); expect(returned).toBe(false);
        await vi.advanceTimersByTimeAsync(1); const reply = await response;
        expect(reply).toEqual(skillHandoffCard()); expect(vi.getTimerCount()).toBe(0);
        if (completion === "resolve") pending.resolve(skillReply("SYNTHETIC_LATE_REPLY"));
        else pending.reject(new Error("SYNTHETIC_PRIVATE_LATE_ERROR"));
        await vi.advanceTimersByTimeAsync(1);
        expect(reply).toEqual(skillHandoffCard()); expect(vi.getTimerCount()).toBe(0);
    });

    it("bounds a hung known settlement in the actual service", async () => {
        vi.useFakeTimers(); const { deps, f, execute } = setup();
        const transaction = f.db.$transaction.bind(f.db);
        const pending = deferred<never>();
        let selectedReads = 0, held = false;
        const realExecute = execute.getMockImplementation()!;
        execute.mockImplementation(async (call, signal) => {
            const value = await realExecute(call, signal);
            if (call.name === "get_approved_guidance") selectedReads++;
            return value;
        });
        vi.spyOn(f.db, "$transaction").mockImplementation((...args) => {
            if (!held && f.state.aiServiceRequest[0]?.dispatched && selectedReads > 0) {
                held = true; return pending.promise;
            }
            return transaction(...args);
        });
        const response = handleKakaoSkill(headers(), JSON.stringify(payload()), requestId, deps);
        await vi.advanceTimersByTimeAsync(3999); expect(held).toBe(true);
        await vi.advanceTimersByTimeAsync(1);
        const reply = await response; expect(reply).toEqual(skillHandoffCard()); expect(vi.getTimerCount()).toBe(0);
        const reads = execute.mock.calls.length;
        pending.reject(new Error("SYNTHETIC_LATE_SETTLEMENT_ERROR"));
        await vi.advanceTimersByTimeAsync(1);
        expect(reply).toEqual(skillHandoffCard());
        expect(execute).toHaveBeenCalledTimes(reads); expect(vi.getTimerCount()).toBe(0);
    });

    it("leaves the public route disabled before body/DB processing", async () => {
        const response = await publicSkill(new Request("http://localhost"));
        expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual(skillReply());
    });

    it("accepts a version-less real request and an explicit 2.0 version", async () => {
        const { run } = setup();
        // Each run needs its own request id: the ledger dedups by request hash,
        // so reusing one id would make the later runs return the HANDOFF card.
        expect(await run(payload(), "synthetic-skill-versionless")).toEqual(skillReply(guidance));
        expect((await run(payload(), "synthetic-skill-versionless-again")).version).toBe("2.0");
        expect(await run({ ...payload(), version: "2.0" }, "synthetic-skill-version-20")).toEqual(skillReply(guidance));
    });

    it("serializes the real-request fixture without a version key", () => {
        expect(JSON.stringify(payload())).not.toContain('"version"');
    });

    it("returns the HANDOFF card with the exact approved shape", () => {
        const card = skillHandoffCard();
        expect(card).toEqual({ version: "2.0", template: { outputs: [{ textCard: { title: "야호 상담 안내",
            description: HANDOFF, buttons: [{ action: "operator", label: "담당자 연결" }] } }] } });
        expect(skillCardReplySchema.parse(card)).toEqual(card);
        expect(card.version).toBe("2.0");
    });

    it("fixes the HANDOFF card length budget", () => {
        expect(HANDOFF_CARD_TITLE.length).toBe(8);
        expect(HANDOFF.length).toBe(31);
        expect(HANDOFF_CARD_TITLE.length + HANDOFF.length).toBe(39);
        expect(HANDOFF_CARD_TITLE.length + HANDOFF.length).toBeLessThanOrEqual(400);
        expect(HANDOFF_CARD_BUTTON_LABEL.length).toBe(6);
        expect(HANDOFF_CARD_BUTTON_LABEL.length).toBeLessThanOrEqual(14);
    });

    it("rejects an over-budget card description and accepts the exact boundary", () => {
        expect(() => skillHandoffCard("x".repeat(393))).toThrow("AI_SERVICE_DENIED");
        expect(skillCardReplySchema.parse(skillHandoffCard("x".repeat(392)))).toBeTruthy();
    });

    it("returns version 2.0 on grounded and HANDOFF card replies", async () => {
        const { run } = setup();
        expect((await run()).version).toBe("2.0");
        const { run: handoffRun } = setup();
        const body = payload(); body.userRequest.utterance = "야호 준비물과 우천 안내";
        expect((await handoffRun(body)).version).toBe("2.0");
    });
});
