import { randomUUID } from "node:crypto";
import { SkillDiagCode as C, SkillDiagDenied, emitSkillDiag } from "@/server/ai-service/skill-diag";
import { prisma } from "@/lib/db/prisma";
import { environmentSchema } from "@/server/ai-service/contracts";
import { createLiveDependencies } from "@/server/ai-service/factory";
import { deriveStableRequestId } from "@/server/ai-service/request-id";
import { assertSyntheticSkillEnabled, disabledResponse } from "@/server/ai-service/runtime";
import { handleKakaoSkill } from "@/server/ai-service/skill";
import { authenticateSkillContext, verifiedSkillKind } from "@/server/ai-service/transport";
import { validateSyntheticScope } from "@/server/ai-service/synthetic-scope";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Independently gated preview-only synthetic entry point.
export async function POST(request: Request) {
    const correlationId = randomUUID();
    try {
        assertSyntheticSkillEnabled();
        let environment: ReturnType<typeof environmentSchema.parse>;
        try { environment = environmentSchema.parse(process.env.VERCEL_ENV === "preview" ? "PREVIEW" : process.env.VERCEL_ENV === "production" ? "PRODUCTION" : null); }
        catch { throw new SkillDiagDenied(C.S2_ENV_INVALID); }
        const secret = process.env.AI_SERVICE_SKILL_SECRET;
        const authContext = authenticateSkillContext(request.headers, { prod: secret, test: process.env.AI_SERVICE_SKILL_TEST_SECRET }, environment);
        let kind: ReturnType<typeof verifiedSkillKind>;
        try { kind = verifiedSkillKind(authContext, environment); } catch { throw new SkillDiagDenied(C.S4_CONTEXT_INVALID); }
        if (kind !== "test") throw new SkillDiagDenied(C.S4_PROD_KIND);
        let raw: string;
        try { raw = await request.text(); } catch { throw new SkillDiagDenied(C.S5_BODY_READ_FAILED); }
        if (Buffer.byteLength(raw, "utf8") > 16384) throw new SkillDiagDenied(C.S5_BODY_TOO_LARGE);
        const scope = validateSyntheticScope(raw);
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { throw new SkillDiagDenied(C.S7_JSON_INVALID); }
        const asRecord = (v: unknown): Record<string, unknown> => typeof v === "object" && v !== null ? v as Record<string, unknown> : {};
        const asString = (v: unknown): string => typeof v === "string" ? v : "";
        const root = asRecord(parsed);
        const bot = asRecord(root.bot);
        const userRequest = asRecord(root.userRequest);
        const user = asRecord(userRequest.user);
        const properties = asRecord(user.properties);
        const block = asRecord(userRequest.block);
        const payloadBotId = asString(bot.id);
        const userId = asString(user.id) || asString(properties.plusfriendUserKey);
        const blockId = asString(block.id);
        const utterance = asString(userRequest.utterance);
        const stableRequestId = deriveStableRequestId({ botId: payloadBotId, userId, blockId, utterance, now: new Date() });
        const botId = process.env.AI_SERVICE_BOT_ID ?? "";
        if (!botId) throw new SkillDiagDenied(C.S8_BOT_ID_MISSING);
        const deps = createLiveDependencies({ env: process.env, db: prisma, environment, botId, scope });
        const reply = await handleKakaoSkill(request.headers, raw, stableRequestId, deps, undefined, authContext);
        return Response.json(reply, { status: 200, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    } catch (error) {
        await emitSkillDiag({ code: error instanceof SkillDiagDenied ? error.diagCode : C.S0_UNKNOWN,
            correlationId, testSecretConfigured: error instanceof SkillDiagDenied ? error.testSecretConfigured : undefined });
        return disabledResponse();
    }
}
