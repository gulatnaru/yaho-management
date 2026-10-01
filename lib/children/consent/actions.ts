"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { requireOperationalPrincipal } from "@/lib/auth/authorization";
import { ChildPersonalDataPurgedError } from "@/lib/children/errors";
import { ChildNotFoundError } from "@/lib/reservations/errors";
import { recordChildConsentCore } from "@/server/children/consent";
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

  try {
    // Child 행 잠금 뒤 파기 여부를 판정한다(ADR-058) — 파기와 동시에 실행돼도 파기된 아이에게 이력이 남지 않는다.
    await recordChildConsentCore(prisma, { childId, consent: parsed.data, actorUserId: principal.userId });
  } catch (error) {
    if (error instanceof ChildNotFoundError) {
      return { formError: "아이를 찾을 수 없습니다." };
    }
    if (error instanceof ChildPersonalDataPurgedError) {
      return { formError: "보관기간이 지나 개인정보를 파기한 아이에게는 동의 이력을 기록할 수 없습니다." };
    }
    console.error("[children] failed to record consent:", error instanceof Error ? error.message : "unknown error");
    return { formError: "동의 이력을 기록하지 못했습니다. 다시 시도해주세요." };
  }
  revalidatePath(`/children/${childId}`);
  return { success: true };
}
