"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/auth/authorization";
import { programInputSchema, type ProgramInput } from "@/lib/validation/program";

export type ProgramFormState = {
  errors?: Partial<Record<keyof ProgramInput, string[]>>;
  formError?: string;
};

function parseProgramForm(formData: FormData) {
  return programInputSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    targetAgeMin: formData.get("targetAgeMin") || undefined,
    targetAgeMax: formData.get("targetAgeMax") || undefined,
    defaultDuration: formData.get("defaultDuration") || undefined,
    defaultPrice: formData.get("defaultPrice") || undefined,
    memo: formData.get("memo") || undefined,
  });
}

export async function createProgram(_prevState: ProgramFormState, formData: FormData): Promise<ProgramFormState> {
  await requireAdmin();

  const result = parseProgramForm(formData);
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  let createdId: string;
  try {
    const program = await prisma.program.create({
      data: {
        name: result.data.name,
        description: result.data.description || null,
        targetAgeMin: result.data.targetAgeMin ?? null,
        targetAgeMax: result.data.targetAgeMax ?? null,
        defaultDuration: result.data.defaultDuration ?? null,
        defaultPrice: result.data.defaultPrice,
        status: "ACTIVE",
        memo: result.data.memo || null,
      },
    });
    createdId = program.id;
  } catch (error) {
    console.error("[programs] failed to create program:", error instanceof Error ? error.message : "unknown error");
    return { formError: "프로그램 등록에 실패했습니다. 다시 시도해주세요." };
  }

  revalidatePath("/programs");
  redirect(`/programs/${createdId}`);
}

export async function updateProgram(
  id: string,
  _prevState: ProgramFormState,
  formData: FormData,
): Promise<ProgramFormState> {
  await requireAdmin();

  const result = parseProgramForm(formData);
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  try {
    await prisma.program.update({
      where: { id },
      data: {
        name: result.data.name,
        description: result.data.description || null,
        targetAgeMin: result.data.targetAgeMin ?? null,
        targetAgeMax: result.data.targetAgeMax ?? null,
        defaultDuration: result.data.defaultDuration ?? null,
        defaultPrice: result.data.defaultPrice,
        memo: result.data.memo || null,
      },
    });
  } catch (error) {
    console.error("[programs] failed to update program:", error instanceof Error ? error.message : "unknown error");
    return { formError: "프로그램 정보 수정에 실패했습니다. 다시 시도해주세요." };
  }

  revalidatePath("/programs");
  revalidatePath(`/programs/${id}`);
  redirect(`/programs/${id}`);
}

export async function setProgramStatus(id: string, status: "ACTIVE" | "INACTIVE"): Promise<{ error?: string }> {
  await requireAdmin();

  try {
    await prisma.program.update({
      where: { id },
      data: { status },
    });
  } catch (error) {
    console.error(
      "[programs] failed to update program status:",
      error instanceof Error ? error.message : "unknown error",
    );
    return { error: "상태 변경에 실패했습니다." };
  }

  revalidatePath("/programs");
  revalidatePath(`/programs/${id}`);
  return {};
}
