import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HANDOFF } from "@/server/ai-service/contracts";
import { handleSkill } from "@/server/ai-service/handler";
import { syntheticContext, syntheticHandlerDependencies } from "@/tests/eval/ai-service/synthetic";

const secret = "synthetic-cost-cap-secret-0123456789abcdef";
const headers = () => new Headers({ "x-yaho-skill-key": secret });
const raw = JSON.stringify({ bot: { id: "synthetic-bot" },
    userRequest: { utterance: "야호 준비물을 알려 주세요", user: { id: "synthetic-guardian" } },
    action: { id: "synthetic-action", name: "synthetic" } });
const keys = () => ({ encryption: { v1: randomBytes(32) }, hmac: { v1: randomBytes(32) }, activeEncryption: "v1", activeHmac: "v1" });

function setup() {
    const context = syntheticContext();
    const deps = syntheticHandlerDependencies(context);
    deps.keys = keys();
    deps.secret = secret;
    deps.botId = "synthetic-bot";
    return { context, deps };
}

describe("cost cap breach (flow 9, handler level)", () => {
    it("blocks the call when the month is 1 KRW short of the hardcap and creates no request", async () => {
        const { context, deps } = setup();
        context.fake.seed("aiServiceBudgetMonth", { environment: "PREVIEW", month: "2026-10", capKrw: 1000, usedKrw: 999, reservedKrw: 0, correctionKrw: 0, billedKrw: 0, unknownCount: 0 });
        const result = await handleSkill(headers(), raw, "cost-cap-request-0001", deps);
        expect(result.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(context.fake.state.aiServiceRequest).toHaveLength(0);
    });

    it("blocks the call when the FX rate is older than 72 hours and creates no request", async () => {
        const { context, deps } = setup();
        Object.assign(context.fake.state.aiServiceConfig[0], { fxCheckedAt: new Date("2026-10-11T00:00:00Z") });
        const result = await handleSkill(headers(), raw, "cost-cap-request-0002", deps);
        expect(result.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(context.fake.state.aiServiceRequest).toHaveLength(0);
    });

    it("blocks the call when no price configuration exists and creates no request", async () => {
        const { context, deps } = setup();
        context.fake.state.aiServiceConfig.length = 0;
        const result = await handleSkill(headers(), raw, "cost-cap-request-0003", deps);
        expect(result.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(context.fake.state.aiServiceRequest).toHaveLength(0);
    });

    it("blocks the call when a previous month still holds an unconfirmed reserve", async () => {
        const { context, deps } = setup();
        context.fake.seed("aiServiceBudgetMonth", { environment: "PREVIEW", month: "2026-09", capKrw: 1000, usedKrw: 0, reservedKrw: 5, correctionKrw: 0, billedKrw: 0, unknownCount: 0 });
        const result = await handleSkill(headers(), raw, "cost-cap-request-0004", deps);
        expect(result.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(context.fake.state.aiServiceRequest).toHaveLength(0);
    });

    it("admits the call when the month has headroom, and settles exactly once at 0 KRW", async () => {
        const { context, deps } = setup();
        context.fake.seed("aiServiceBudgetMonth", { environment: "PREVIEW", month: "2026-10", capKrw: 1000, usedKrw: 100, reservedKrw: 0, correctionKrw: 0, billedKrw: 0, unknownCount: 0 });
        const result = await handleSkill(headers(), raw, "cost-cap-request-0005", deps);
        expect(result.template.outputs[0].simpleText.text).toBe("합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요.");
        expect(context.fake.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", dispatched: true, usedKrw: 0 });
    });
});
