"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/auth/authorization";
import { teacherInputSchema, type TeacherInput } from "@/lib/validation/teacher";

export type TeacherFormValues = {
  name?: string;
  phone?: string;
  memo?: string;
};

export type TeacherFormState = {
  errors?: Partial<Record<keyof TeacherInput, string[]>>;
  formError?: string;
  values?: TeacherFormValues;
};

function parseTeacherForm(formData: FormData) {
  return teacherInputSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone") || undefined,
    memo: formData.get("memo") || undefined,
  });
}

/**
 * 검증 실패 시 사용자가 실제로 타이핑한 원본 문자열 값을 그대로 돌려주기 위해 사용한다.
 * React 19 의 Server Action 폼은 액션 완료(성공/실패 무관) 시 uncontrolled 필드를 defaultValue 로
 * 리셋하므로, 검증 실패 응답에 원본 값을 담아 폼이 defaultValue 대신 이 값을 우선 사용하게 한다.
 */
function readTeacherFormValues(formData: FormData): TeacherFormValues {
  const toStringOrUndefined = (value: FormDataEntryValue | null) =>
    typeof value === "string" ? value : undefined;

  return {
    name: toStringOrUndefined(formData.get("name")),
    phone: toStringOrUndefined(formData.get("phone")),
    memo: toStringOrUndefined(formData.get("memo")),
  };
}

export async function createTeacher(_prevState: TeacherFormState, formData: FormData): Promise<TeacherFormState> {
  await requireAdmin();

  const result = parseTeacherForm(formData);
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors, values: readTeacherFormValues(formData) };
  }

  let createdId: string;
  try {
    const teacher = await prisma.teacher.create({
      data: {
        name: result.data.name,
        phone: result.data.phone ?? null,
        memo: result.data.memo || null,
      },
    });
    createdId = teacher.id;
  } catch (error) {
    console.error("[teachers] failed to create teacher:", error instanceof Error ? error.message : "unknown error");
    return { formError: "선생님 등록에 실패했습니다. 다시 시도해주세요.", values: readTeacherFormValues(formData) };
  }

  revalidatePath("/teachers");
  redirect(`/teachers/${createdId}`);
}

export async function updateTeacher(
  id: string,
  _prevState: TeacherFormState,
  formData: FormData,
): Promise<TeacherFormState> {
  await requireAdmin();

  const result = parseTeacherForm(formData);
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors, values: readTeacherFormValues(formData) };
  }

  try {
    await prisma.teacher.update({
      where: { id },
      data: {
        name: result.data.name,
        phone: result.data.phone ?? null,
        memo: result.data.memo || null,
      },
    });
  } catch (error) {
    console.error("[teachers] failed to update teacher:", error instanceof Error ? error.message : "unknown error");
    return {
      formError: "선생님 정보 수정에 실패했습니다. 다시 시도해주세요.",
      values: readTeacherFormValues(formData),
    };
  }

  revalidatePath("/teachers");
  revalidatePath(`/teachers/${id}`);
  redirect(`/teachers/${id}`);
}

export async function setTeacherActive(id: string, isActive: boolean): Promise<{ error?: string }> {
  await requireAdmin();

  try {
    await prisma.teacher.update({
      where: { id },
      data: { isActive },
    });
  } catch (error) {
    console.error(
      "[teachers] failed to update teacher status:",
      error instanceof Error ? error.message : "unknown error",
    );
    return { error: "상태 변경에 실패했습니다." };
  }

  revalidatePath("/teachers");
  revalidatePath(`/teachers/${id}`);
  return {};
}
