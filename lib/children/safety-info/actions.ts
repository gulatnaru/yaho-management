"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/auth/authorization";
import { childSafetyInfoInputSchema } from "./validation";

export type SafetyInfoFormState = {
  errors?: Record<string, string[]>;
  formError?: string;
  values?: Record<string, string | undefined>;
};

function readValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

export async function updateChildSafetyInfo(
  childId: string,
  _previousState: SafetyInfoFormState,
  formData: FormData,
): Promise<SafetyInfoFormState> {
  const session = await requireAdmin();
  const parsed = childSafetyInfoInputSchema.safeParse({
    allergies: readValue(formData, "allergies"),
    emergencyNotes: readValue(formData, "emergencyNotes"),
    emergencyContactName: readValue(formData, "emergencyContactName"),
    emergencyContactPhone: readValue(formData, "emergencyContactPhone"),
    emergencyContactRelation: readValue(formData, "emergencyContactRelation"),
  });

  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors,
      values: {
        allergies: readValue(formData, "allergies"),
        emergencyNotes: readValue(formData, "emergencyNotes"),
        emergencyContactName: readValue(formData, "emergencyContactName"),
        emergencyContactPhone: readValue(formData, "emergencyContactPhone"),
        emergencyContactRelation: readValue(formData, "emergencyContactRelation"),
      },
    };
  }

  const child = await prisma.child.findUnique({ where: { id: childId }, select: { id: true } });
  if (!child) {
    return { formError: "아이를 찾을 수 없습니다." };
  }

  await prisma.childSafetyInfo.upsert({
    where: { childId },
    create: { childId, ...parsed.data, updatedById: session.user.id },
    update: { ...parsed.data, updatedById: session.user.id },
  });

  revalidatePath(`/children/${childId}`);
  revalidatePath(`/children/${childId}/safety`);
  redirect(`/children/${childId}`);
}
