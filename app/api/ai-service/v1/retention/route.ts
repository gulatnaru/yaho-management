import { disabledResponse } from "@/server/ai-service/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Daily scheduler wiring requires separate operational approval; no cron is activated.
export async function GET() { return disabledResponse(); }
export async function POST() { return disabledResponse(); }
