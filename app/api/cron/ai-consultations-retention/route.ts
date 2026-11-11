import { prisma } from "@/lib/db/prisma";
import { runRetentionCron } from "@/server/ai-service/retention";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Daily auto-delete cron (D-1). Vercel Cron sends GET only. Activation is
 * gated by CRON_SECRET auth plus the AiServiceConfig.schedulerEnabled flag;
 * the flag stays false until a separate operations approval, so deploying
 * this route never starts deletion by itself. Vercel Cron fires only on
 * Production deploys, so this route is inert on Preview.
 */
export async function GET(request: Request) {
    const result = await runRetentionCron(prisma, request.headers.get("authorization"), process.env.VERCEL_ENV, process.env.CRON_SECRET, new Date());
    return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
