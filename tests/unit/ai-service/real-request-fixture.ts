// Shared real Kakao SkillPayload fixture (official answer_json_format shape).
// There is NO top-level `version` key — it is a response-only field. intent /
// flow / contexts / block / properties / params / lang / timezone ride along
// as passthrough and are ignored by the adapter. Used by skill.test.ts,
// skill-auth.test.ts and the integration contract test so the three suites
// can never drift apart on the real-request shape.
export function realRequestPayload() {
    return {
        bot: { id: "synthetic-bot", name: "야호 챗봇" },
        intent: { id: "synthetic-intent", name: "AI 상담" },
        action: {
            id: "synthetic-action", name: "synthetic",
            params: {},
            detailParams: {},
            clientExtra: null as unknown,
        },
        userRequest: {
            block: { id: "synthetic-block", name: "AI 상담" },
            user: { id: "synthetic-subject", type: "botUserKey", properties: { plusfriendUserKey: "synthetic-plusfriend-key" } },
            utterance: "야호 준비물을 알려 주세요",
            params: { surface: "Kakaotalk.plusfriend" },
            lang: "ko", timezone: "Asia/Seoul",
        },
        flow: { trigger: { type: "TEXT_INPUT" }, lastBlock: { id: "synthetic-block", name: "AI 상담" } },
        contexts: [],
    };
}
export type RealRequestPayload = ReturnType<typeof realRequestPayload>;
