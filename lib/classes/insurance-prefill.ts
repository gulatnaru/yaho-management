import { prisma } from "@/lib/db/prisma";

export type InsurancePrefill = {
  insured: boolean;
  insurer: string | null;
  insurancePolicyNo: string | null;
  safetyMemo: string | null;
};

export async function getLatestInsurancePrefill(beforeClassId?: string): Promise<InsurancePrefill | null> {
  let beforeStartsAt: Date | undefined;
  if (beforeClassId) {
    const current = await prisma.classSchedule.findUnique({ where: { id: beforeClassId }, select: { startsAt: true } });
    beforeStartsAt = current?.startsAt;
  }
  return prisma.classSchedule.findFirst({
    where: beforeStartsAt ? { startsAt: { lt: beforeStartsAt } } : undefined,
    select: { insured: true, insurer: true, insurancePolicyNo: true, safetyMemo: true },
    orderBy: { startsAt: "desc" },
  });
}
