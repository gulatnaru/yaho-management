import { prisma } from "@/lib/db/prisma";
import type { ConsentType } from "./validation";

const CONSENT_SELECT = {
  id: true,
  childId: true,
  consentType: true,
  action: true,
  recordedAt: true,
  memo: true,
  recordedBy: { select: { name: true } },
} as const;

export async function getChildConsentHistory(childId: string) {
  return prisma.childConsent.findMany({
    where: { childId },
    select: CONSENT_SELECT,
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
  });
}

export async function getChildConsentSummary(childId: string) {
  const history = await getChildConsentHistory(childId);
  const current = new Map<ConsentType, (typeof history)[number]>();
  for (const record of history) {
    if (!current.has(record.consentType as ConsentType)) {
      current.set(record.consentType as ConsentType, record);
    }
  }
  return { history, current };
}
