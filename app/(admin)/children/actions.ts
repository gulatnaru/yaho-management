"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/auth/authorization";
import { childInputSchema, type ChildInput } from "@/lib/validation/child";

export type ChildFormState = {
  errors?: Partial<Record<keyof ChildInput, string[]>>;
  formError?: string;
};

function parseChildForm(formData: FormData) {
  return childInputSchema.safeParse({
    name: formData.get("name"),
    birthDate: formData.get("birthDate") || undefined,
    gender: formData.get("gender") || undefined,
    guardianName: formData.get("guardianName") || undefined,
    guardianPhone: formData.get("guardianPhone") || undefined,
    memo: formData.get("memo") || undefined,
  });
}

export async function createChild(_prevState: ChildFormState, formData: FormData): Promise<ChildFormState> {
  await requireAdmin();

  const result = parseChildForm(formData);
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  let createdId: string;
  try {
    const child = await prisma.child.create({
      data: {
        name: result.data.name,
        birthDate: result.data.birthDate ? new Date(result.data.birthDate) : null,
        gender: result.data.gender,
        guardianName: result.data.guardianName ?? null,
        guardianPhone: result.data.guardianPhone ?? null,
        memo: result.data.memo || null,
      },
    });
    createdId = child.id;
  } catch (error) {
    console.error("[children] failed to create child:", error instanceof Error ? error.message : "unknown error");
    return { formError: "아이 등록에 실패했습니다. 다시 시도해주세요." };
  }

  revalidatePath("/children");
  redirect(`/children/${createdId}`);
}

export async function updateChild(
  id: string,
  _prevState: ChildFormState,
  formData: FormData,
): Promise<ChildFormState> {
  await requireAdmin();

  const result = parseChildForm(formData);
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  try {
    await prisma.child.update({
      where: { id },
      data: {
        name: result.data.name,
        birthDate: result.data.birthDate ? new Date(result.data.birthDate) : null,
        gender: result.data.gender,
        guardianName: result.data.guardianName ?? null,
        guardianPhone: result.data.guardianPhone ?? null,
        memo: result.data.memo || null,
      },
    });
  } catch (error) {
    console.error("[children] failed to update child:", error instanceof Error ? error.message : "unknown error");
    return { formError: "아이 정보 수정에 실패했습니다. 다시 시도해주세요." };
  }

  revalidatePath("/children");
  revalidatePath(`/children/${id}`);
  redirect(`/children/${id}`);
}

export async function setChildActive(id: string, isActive: boolean): Promise<{ error?: string }> {
  await requireAdmin();

  try {
    await prisma.child.update({
      where: { id },
      data: { isActive },
    });
  } catch (error) {
    console.error("[children] failed to update child status:", error instanceof Error ? error.message : "unknown error");
    return { error: "상태 변경에 실패했습니다." };
  }

  revalidatePath("/children");
  revalidatePath(`/children/${id}`);
  return {};
}
