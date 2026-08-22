"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/auth/authorization";
import { childInputSchema, type ChildInput } from "@/lib/validation/child";

export type ChildFormValues = {
  name?: string;
  birthDate?: string;
  gender?: string;
  guardianName?: string;
  guardianPhone?: string;
  memo?: string;
};

export type ChildFormState = {
  errors?: Partial<Record<keyof ChildInput, string[]>>;
  formError?: string;
  values?: ChildFormValues;
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

/**
 * 검증 실패 시 사용자가 실제로 타이핑한 원본 문자열 값을 그대로 돌려주기 위해 사용한다.
 * React 19 의 Server Action 폼은 액션 완료(성공/실패 무관) 시 uncontrolled 필드를 defaultValue 로
 * 리셋하므로, 검증 실패 응답에 원본 값을 담아 폼이 defaultValue 대신 이 값을 우선 사용하게 한다.
 */
function readChildFormValues(formData: FormData): ChildFormValues {
  const toStringOrUndefined = (value: FormDataEntryValue | null) =>
    typeof value === "string" ? value : undefined;

  return {
    name: toStringOrUndefined(formData.get("name")),
    birthDate: toStringOrUndefined(formData.get("birthDate")),
    gender: toStringOrUndefined(formData.get("gender")),
    guardianName: toStringOrUndefined(formData.get("guardianName")),
    guardianPhone: toStringOrUndefined(formData.get("guardianPhone")),
    memo: toStringOrUndefined(formData.get("memo")),
  };
}

export async function createChild(_prevState: ChildFormState, formData: FormData): Promise<ChildFormState> {
  await requireAdmin();

  const result = parseChildForm(formData);
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors, values: readChildFormValues(formData) };
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
    return { formError: "아이 등록에 실패했습니다. 다시 시도해주세요.", values: readChildFormValues(formData) };
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
    return { errors: result.error.flatten().fieldErrors, values: readChildFormValues(formData) };
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
    return { formError: "아이 정보 수정에 실패했습니다. 다시 시도해주세요.", values: readChildFormValues(formData) };
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
