"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/auth/authorization";
import { teacherInputSchema, type TeacherInput } from "@/lib/validation/teacher";

export type TeacherFormState = {
  errors?: Partial<Record<keyof TeacherInput, string[]>>;
  formError?: string;
};

function parseTeacherForm(formData: FormData) {
  return teacherInputSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone") || undefined,
    memo: formData.get("memo") || undefined,
  });
}

export async function createTeacher(_prevState: TeacherFormState, formData: FormData): Promise<TeacherFormState> {
  await requireAdmin();

  const result = parseTeacherForm(formData);
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
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
    return { formError: "선생님 등록에 실패했습니다. 다시 시도해주세요." };
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
    return { errors: result.error.flatten().fieldErrors };
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
    return { formError: "선생님 정보 수정에 실패했습니다. 다시 시도해주세요." };
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
