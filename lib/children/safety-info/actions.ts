"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireOperationalPrincipal } from "@/lib/auth/authorization";
import { readFormString } from "@/lib/forms/form-data";
import { childSafetyInfoInputSchema } from "./validation";

export type SafetyInfoFormState = {
  errors?: Record<string, string[]>;
  formError?: string;
  values?: Record<string, string | undefined>;
};

export async function updateChildSafetyInfo(
  childId: string,
  _previousState: SafetyInfoFormState,
  formData: FormData,
): Promise<SafetyInfoFormState> {
  const principal = await requireOperationalPrincipal();
  const parsed = childSafetyInfoInputSchema.safeParse({
    allergies: readFormString(formData, "allergies"),
    emergencyNotes: readFormString(formData, "emergencyNotes"),
    emergencyContactName: readFormString(formData, "emergencyContactName"),
    emergencyContactPhone: readFormString(formData, "emergencyContactPhone"),
    emergencyContactRelation: readFormString(formData, "emergencyContactRelation"),
  });

  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors,
      values: {
        allergies: readFormString(formData, "allergies"),
        emergencyNotes: readFormString(formData, "emergencyNotes"),
        emergencyContactName: readFormString(formData, "emergencyContactName"),
        emergencyContactPhone: readFormString(formData, "emergencyContactPhone"),
        emergencyContactRelation: readFormString(formData, "emergencyContactRelation"),
      },
    };
  }

  const child = await prisma.child.findUnique({ where: { id: childId }, select: { id: true } });
  if (!child) {
    return { formError: "아이를 찾을 수 없습니다." };
  }

  await prisma.childSafetyInfo.upsert({
    where: { childId },
    create: { childId, ...parsed.data, updatedById: principal.userId },
    update: { ...parsed.data, updatedById: principal.userId },
  });

  revalidatePath(`/children/${childId}`);
  revalidatePath(`/children/${childId}/safety`);
  redirect(`/children/${childId}`);
}
