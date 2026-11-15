import { prisma } from "@/lib/db/prisma";
import { environmentSchema, ServiceDenied } from "@/server/ai-service/contracts";
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
    try {
        assertSyntheticSkillEnabled();
        const environment = environmentSchema.parse(process.env.VERCEL_ENV === "preview" ? "PREVIEW" : process.env.VERCEL_ENV === "production" ? "PRODUCTION" : null);
        const secret = process.env.AI_SERVICE_SKILL_SECRET;
        const authContext = authenticateSkillContext(request.headers, { prod: secret, test: process.env.AI_SERVICE_SKILL_TEST_SECRET }, environment);
        if (verifiedSkillKind(authContext, environment) !== "test") throw new ServiceDenied();
        const raw = await request.text();
        if (Buffer.byteLength(raw, "utf8") > 16384) throw new ServiceDenied();
        const scope = validateSyntheticScope(raw);
        const parsed: unknown = JSON.parse(raw);
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
        if (!botId) throw new ServiceDenied();
        const deps = createLiveDependencies({ env: process.env, db: prisma, environment, botId, scope });
        const reply = await handleKakaoSkill(request.headers, raw, stableRequestId, deps, undefined, authContext);
        return Response.json(reply, { status: 200, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    } catch {
        return disabledResponse();
    }
}
