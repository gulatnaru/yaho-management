"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireOperationalPrincipal } from "@/lib/auth/authorization";
import { ChildPersonalDataPurgedError } from "@/lib/children/errors";
import { readFormString } from "@/lib/forms/form-data";
import { ChildNotFoundError } from "@/lib/reservations/errors";
import { upsertChildSafetyInfoCore } from "@/server/children/safety-info";
import { childSafetyInfoInputSchema } from "./validation";

export type SafetyInfoFormState = {
  errors?: Record<string, string[]>;
  formError?: string;
  values?: Record<string, string | undefined>;
};

function readSafetyInfoFormValues(formData: FormData): Record<string, string | undefined> {
  return {
    allergies: readFormString(formData, "allergies"),
    emergencyNotes: readFormString(formData, "emergencyNotes"),
    emergencyContactName: readFormString(formData, "emergencyContactName"),
    emergencyContactPhone: readFormString(formData, "emergencyContactPhone"),
    emergencyContactRelation: readFormString(formData, "emergencyContactRelation"),
  };
}

export async function updateChildSafetyInfo(
  childId: string,
  _previousState: SafetyInfoFormState,
  formData: FormData,
): Promise<SafetyInfoFormState> {
  const principal = await requireOperationalPrincipal();
  const parsed = childSafetyInfoInputSchema.safeParse(readSafetyInfoFormValues(formData));

  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors,
      values: readSafetyInfoFormValues(formData),
    };
  }

  try {
    // Child 행 잠금 뒤 파기 여부를 판정한다(ADR-058) — 파기와 동시에 실행돼도 파기된 아이에게 안전정보가 다시 생기지 않는다.
    await upsertChildSafetyInfoCore(prisma, { childId, safetyInfo: parsed.data, actorUserId: principal.userId });
  } catch (error) {
    if (error instanceof ChildNotFoundError) {
      return { formError: "아이를 찾을 수 없습니다." };
    }
    if (error instanceof ChildPersonalDataPurgedError) {
      return { formError: "보관기간이 지나 개인정보를 파기한 아이에게는 안전정보를 기록할 수 없습니다." };
    }
    console.error("[children] failed to save safety info:", error instanceof Error ? error.message : "unknown error");
    return { formError: "안전정보를 저장하지 못했습니다. 다시 시도해주세요.", values: readSafetyInfoFormValues(formData) };
  }

  revalidatePath(`/children/${childId}`);
  revalidatePath(`/children/${childId}/safety`);
  redirect(`/children/${childId}`);
}
