"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireOperationalPrincipal } from "@/lib/auth/authorization";
import {
  programInputSchema,
  programOperationalInputSchema,
  type ProgramInput,
  type ProgramOperationalInput,
} from "@/lib/validation/program";

export type ProgramFormValues = {
  name?: string;
  description?: string;
  targetAgeMin?: string;
  targetAgeMax?: string;
  defaultDuration?: string;
  defaultPrice?: string;
  memo?: string;
};

export type ProgramFormState = {
  errors?: Partial<Record<keyof ProgramInput | keyof ProgramOperationalInput, string[]>>;
  formError?: string;
  values?: ProgramFormValues;
};

function readOperationalProgramInput(formData: FormData) {
  return {
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    targetAgeMin: formData.get("targetAgeMin") || undefined,
    targetAgeMax: formData.get("targetAgeMax") || undefined,
    defaultDuration: formData.get("defaultDuration") || undefined,
    memo: formData.get("memo") || undefined,
  };
}

function parseProgramForm(formData: FormData, includeFinancialFields: boolean) {
  const operationalInput = readOperationalProgramInput(formData);
  return includeFinancialFields
    ? programInputSchema.safeParse({
        ...operationalInput,
        defaultPrice: formData.get("defaultPrice") || undefined,
      })
    : programOperationalInputSchema.safeParse(operationalInput);
}

/**
 * 검증 실패 시 사용자가 실제로 타이핑한 원본 문자열 값을 그대로 돌려주기 위해 사용한다.
 * React 19 의 Server Action 폼은 액션 완료(성공/실패 무관) 시 uncontrolled 필드를 defaultValue 로
 * 리셋하므로, 검증 실패 응답에 원본 값을 담아 폼이 defaultValue 대신 이 값을 우선 사용하게 한다.
 */
function readProgramFormValues(formData: FormData, includeFinancialFields: boolean): ProgramFormValues {
  const toStringOrUndefined = (value: FormDataEntryValue | null) =>
    typeof value === "string" ? value : undefined;

  return {
    name: toStringOrUndefined(formData.get("name")),
    description: toStringOrUndefined(formData.get("description")),
    targetAgeMin: toStringOrUndefined(formData.get("targetAgeMin")),
    targetAgeMax: toStringOrUndefined(formData.get("targetAgeMax")),
    defaultDuration: toStringOrUndefined(formData.get("defaultDuration")),
    ...(includeFinancialFields ? { defaultPrice: toStringOrUndefined(formData.get("defaultPrice")) } : {}),
    memo: toStringOrUndefined(formData.get("memo")),
  };
}

export async function createProgram(_prevState: ProgramFormState, formData: FormData): Promise<ProgramFormState> {
  const principal = await requireOperationalPrincipal();
  const includeFinancialFields = principal.role === "ADMIN";

  const result = parseProgramForm(formData, includeFinancialFields);
  if (!result.success) {
    return {
      errors: result.error.flatten().fieldErrors,
      values: readProgramFormValues(formData, includeFinancialFields),
    };
  }

  let createdId: string;
  try {
    const defaultPrice =
      "defaultPrice" in result.data && typeof result.data.defaultPrice === "number"
        ? result.data.defaultPrice
        : undefined;
    const program = await prisma.program.create({
      data: {
        name: result.data.name,
        description: result.data.description || null,
        targetAgeMin: result.data.targetAgeMin ?? null,
        targetAgeMax: result.data.targetAgeMax ?? null,
        defaultDuration: result.data.defaultDuration ?? null,
        ...(includeFinancialFields && defaultPrice !== undefined ? { defaultPrice } : {}),
        status: "ACTIVE",
        memo: result.data.memo || null,
      },
      select: { id: true },
    });
    createdId = program.id;
  } catch (error) {
    console.error("[programs] failed to create program:", error instanceof Error ? error.message : "unknown error");
    return {
      formError: "프로그램 등록에 실패했습니다. 다시 시도해주세요.",
      values: readProgramFormValues(formData, includeFinancialFields),
    };
  }

  revalidatePath("/programs");
  redirect(`/programs/${createdId}`);
}

export async function updateProgram(
  id: string,
  _prevState: ProgramFormState,
  formData: FormData,
): Promise<ProgramFormState> {
  const principal = await requireOperationalPrincipal();
  const includeFinancialFields = principal.role === "ADMIN";

  const result = parseProgramForm(formData, includeFinancialFields);
  if (!result.success) {
    return {
      errors: result.error.flatten().fieldErrors,
      values: readProgramFormValues(formData, includeFinancialFields),
    };
  }

  try {
    const defaultPrice =
      "defaultPrice" in result.data && typeof result.data.defaultPrice === "number"
        ? result.data.defaultPrice
        : undefined;
    await prisma.program.update({
      where: { id },
      data: {
        name: result.data.name,
        description: result.data.description || null,
        targetAgeMin: result.data.targetAgeMin ?? null,
        targetAgeMax: result.data.targetAgeMax ?? null,
        defaultDuration: result.data.defaultDuration ?? null,
        ...(includeFinancialFields && defaultPrice !== undefined ? { defaultPrice } : {}),
        memo: result.data.memo || null,
      },
    });
  } catch (error) {
    console.error("[programs] failed to update program:", error instanceof Error ? error.message : "unknown error");
    return {
      formError: "프로그램 정보 수정에 실패했습니다. 다시 시도해주세요.",
      values: readProgramFormValues(formData, includeFinancialFields),
    };
  }

  revalidatePath("/programs");
  revalidatePath(`/programs/${id}`);
  redirect(`/programs/${id}`);
}

export async function setProgramStatus(id: string, status: "ACTIVE" | "INACTIVE"): Promise<{ error?: string }> {
  await requireOperationalPrincipal();

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
