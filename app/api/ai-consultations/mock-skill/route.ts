import { mockSkillHandler } from "@/server/ai-consultations/handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = mockSkillHandler({
  environment: process.env,
  client: async () => {
    const { prisma } = await import("@/lib/db/prisma");
    return prisma;
  },
});
