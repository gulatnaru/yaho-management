import { prisma } from "@/lib/db/prisma";

const SAFETY_INFO_SELECT = {
  id: true,
  childId: true,
  allergies: true,
  emergencyNotes: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelation: true,
  updatedById: true,
  updatedAt: true,
  updatedBy: { select: { name: true } },
} as const;

export async function getChildSafetyInfo(childId: string) {
  return prisma.childSafetyInfo.findUnique({ where: { childId }, select: SAFETY_INFO_SELECT });
}
