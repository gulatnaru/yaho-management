import { disabledResponse } from "@/server/ai-service/runtime";
import { syntheticSkillResponse } from "@/server/ai-service/skill-test";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    if (process.env.VERCEL_ENV === "production") return disabledResponse();
    return syntheticSkillResponse(request, process.env.AI_SERVICE_TEST_SKILL_SECRET);
}
