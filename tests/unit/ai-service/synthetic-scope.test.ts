import { describe, expect, it } from "vitest";
import { createSyntheticTools, validateSyntheticScope, type SyntheticScope } from "@/server/ai-service/synthetic-scope";
import { realRequestPayload } from "./real-request-fixture";

const instant = new Date("2026-11-15T12:00:00Z");
const env = { AI_SERVICE_SYNTHETIC_RUN_ID: "synthetic-run-01", AI_SERVICE_SYNTHETIC_EXPIRES_AT: "2099-11-15T13:00:00Z" };
function fixture(utterance = "야호 준비물을 알려 주세요") {
    const payload = realRequestPayload();
    payload.userRequest.user.id = "synthetic-synthetic-run-01";
    payload.userRequest.utterance = utterance;
    return payload;
}
const validate = (payload: unknown, scopeEnv: Readonly<Record<string, string | undefined>> = env) => validateSyntheticScope(JSON.stringify(payload), scopeEnv, instant);

describe("server-owned synthetic execution scope", () => {
    it.each(["야호 준비물을 알려 주세요", "야호 비가 오면 운영하나요", "야호 예약을 도와 주세요"])("accepts the explicitly registered fixture %s", utterance => {
        expect(validate(fixture(utterance))).toBeDefined();
    });
    it("rejects when no run exists or the run is expired", () => {
        expect(() => validate(fixture(), {})).toThrow();
        expect(() => validate(fixture(), { ...env, AI_SERVICE_SYNTHETIC_EXPIRES_AT: instant.toISOString() })).toThrow();
    });
    it("rejects an unregistered utterance even when it resembles ordinary user input", () => {
        expect(() => validate(fixture("야호 오늘 예약을 확인해 주세요"))).toThrow();
    });
    it("rejects a fixture owned by a different run", () => {
        expect(() => validate(fixture(), { ...env, AI_SERVICE_SYNTHETIC_RUN_ID: "different-run" })).toThrow();
    });
    it.each(["bot", "user", "block"] as const)("rejects a modified %s identifier", field => {
        const payload = fixture();
        if (field === "bot") payload.bot.id = "different-bot";
        if (field === "user") payload.userRequest.user.id = "different-user";
        if (field === "block") payload.userRequest.block.id = "different-block";
        expect(() => validate(payload)).toThrow();
    });
    it("does not use client metadata as authorization evidence", () => {
        const payload = fixture();
        payload.userRequest.params.surface = "forged-synthetic";
        payload.action.detailParams = { synthetic: true, run: "different-run" };
        payload.action.clientExtra = { synthetic: true };
        expect(validate(payload)).toBeDefined();
        payload.userRequest.utterance = "야호 실제 예약을 알려 주세요";
        expect(() => validate(payload)).toThrow();
    });
    it("limits the tools to data owned by the scope", async () => {
        const tools = createSyntheticTools(validate(fixture()));
        const signal = new AbortController().signal;
        expect(await tools.execute({ name: "list_public_programs", args: {} }, signal)).toEqual({ kind: "PROGRAMS", items: [] });
        expect(await tools.execute({ name: "get_approved_guidance", args: { topic: "PREPARATION" } }, signal)).toMatchObject({ kind: "GUIDANCE" });
        await expect(tools.execute({ name: "get_class_availability", args: { classHandle: "other-run-class" } }, signal)).rejects.toThrow();
        await expect(tools.execute({ name: "list_public_classes", args: { programHandle: "other-run-program" } }, signal)).rejects.toThrow();
    });
    it("rejects forged scope objects", () => {
        expect(() => createSyntheticTools({} as SyntheticScope)).toThrow();
    });
});
