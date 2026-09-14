"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { requireOperationalPrincipal } from "@/lib/auth/authorization";
import { childConsentInputSchema } from "./validation";

export type ConsentFormState = { errors?: Record<string, string[]>; formError?: string; success?: boolean };

export async function recordChildConsent(
  childId: string,
  _previousState: ConsentFormState,
  formData: FormData,
): Promise<ConsentFormState> {
  const principal = await requireOperationalPrincipal();
  const parsed = childConsentInputSchema.safeParse({
    consentType: formData.get("consentType"),
    action: formData.get("action"),
    memo: formData.get("memo"),
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const child = await prisma.child.findUnique({ where: { id: childId }, select: { id: true } });
  if (!child) {
    return { formError: "아이를 찾을 수 없습니다." };
  }

  await prisma.childConsent.create({
    data: { childId, ...parsed.data, recordedById: principal.userId },
  });
  revalidatePath(`/children/${childId}`);
  return { success: true };
}
