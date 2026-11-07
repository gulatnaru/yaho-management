import { prisma } from "@/lib/db/prisma";
import { environmentSchema, ServiceDenied } from "@/server/ai-service/contracts";
import { createLiveDependencies } from "@/server/ai-service/factory";
import { deriveStableRequestId } from "@/server/ai-service/request-id";
import { assertDeploymentApproved, disabledResponse } from "@/server/ai-service/runtime";
import { handleKakaoSkill } from "@/server/ai-service/skill";
import { authenticateSkill } from "@/server/ai-service/transport";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The deployment lock stays CLOSED: assertDeploymentApproved() always throws
// until a separate ops-approved lock replacement. The code after it is
// unreachable in this build; it is wired so the lock replacement alone
// activates the route.
export async function POST(request: Request) {
    try {
        assertDeploymentApproved();
        const environment = environmentSchema.parse(process.env.VERCEL_ENV === "preview" ? "PREVIEW" : process.env.VERCEL_ENV === "production" ? "PRODUCTION" : null);
        const raw = await request.text();
        const secret = process.env.AI_SERVICE_SKILL_SECRET;
        authenticateSkill(request.headers, secret);
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
        const deps = createLiveDependencies({ env: process.env, db: prisma, environment, botId });
        const reply = await handleKakaoSkill(request.headers, raw, stableRequestId, deps);
        return Response.json(reply, { status: 200, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    } catch {
        return disabledResponse();
    }
}
