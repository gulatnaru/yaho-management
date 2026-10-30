"use server";

import { revalidatePath } from "next/cache";
import { requireInvitationPrincipal } from "@/lib/auth/authorization";
import { readFormString } from "@/lib/forms/form-data";
import { invitationIssueSchema } from "@/lib/validation/accounts";
import {
  cancelInvitationCore,
  InvitationError,
  issueInvitationCore,
  reissueInvitationCore,
} from "@/server/accounts/invitations";
import { deliverIssuedInvitation } from "@/server/accounts/invitation-delivery";
import { AccountMutationError } from "@/server/accounts/mutations";

/**
 * P3 관리자 초대 액션 (SUPER_ADMIN 전용 + INVALID 거부 — requireInvitationPrincipal).
 * 모드 가드를 재사용하지 않는다 (게이트 7).
 *
 * 원본 토큰은 같은 요청의 발송 어댑터에만 전달한다.
 */

export type InvitationFormState = {
  errors?: Partial<Record<"name" | "email" | "role" | "teacherId", string[]>>;
  formError?: string;
  values?: { name?: string; email?: string; role?: string; teacherId?: string };
  success?: boolean;
};

export type InvitationRowActionState = {
  formError?: string;
  success?: boolean;
};

function invitationErrorMessage(error: InvitationError): string {
  switch (error.code) {
    case "INVITATION_FORBIDDEN":
    case "INVITATION_MODE_INVALID":
      return "초대 관리 권한을 다시 확인해주세요.";
    case "INVITATION_EMAIL_ACTIVE":
      return "이미 활성화된 계정이 있는 이메일입니다. 역할 변경은 계정 관리에서 수행해주세요.";
    case "INVITATION_ROLE_MISMATCH":
      return "기존 비활성 계정의 역할과 다릅니다. 역할 변경은 계정 관리에서 수행해주세요.";
    case "INVITATION_NOT_FOUND":
      return "초대를 찾을 수 없습니다.";
    case "INVITATION_ALREADY_USED":
      return "이미 사용된 초대입니다.";
    case "INVITATION_REVOKED":
      return "이미 해지된 초대입니다.";
    case "INVITATION_EXPIRED":
      return "만료된 초대입니다.";
    case "INVITATION_NOT_PENDING":
      return "대기중인 초대가 아닙니다.";
    case "INVITATION_TARGET_ACTIVE":
      return "이미 활성화된 계정입니다.";
    case "INVITATION_TEACHER_UNAVAILABLE":
      return "선택한 선생님을 연결할 수 없습니다.";
    case "INVITATION_INVALID":
      return "유효하지 않은 초대입니다.";
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function issueInvitation(
  _previousState: InvitationFormState,
  formData: FormData,
): Promise<InvitationFormState> {
  const principal = await requireInvitationPrincipal();
  const values = {
    name: readFormString(formData, "name"),
    email: readFormString(formData, "email"),
    role: readFormString(formData, "role"),
    teacherId: readFormString(formData, "teacherId"),
  };
  const result = invitationIssueSchema.safeParse({ ...values, teacherId: values.teacherId || null });
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors, values };
  }
  try {
    // The token stays in this server request and is never returned to the UI.
    const issued = await issueInvitationCore(principal, result.data);
    const delivery = await deliverIssuedInvitation(issued);
    revalidatePath("/invitations");
    if (delivery !== "ACCEPTED") return { formError: delivery === "FAILED" ? "발송 실패. 목록에서 재발급해주세요." : "발송 결과를 확인할 수 없습니다. 목록에서 재발급해주세요." };
  } catch (error) {
    if (error instanceof InvitationError) {
      return { formError: invitationErrorMessage(error), values };
    }
    if (error instanceof AccountMutationError) {
      if (error.code === "TEACHER_REQUIRED") {
        return { formError: "선생님 계정에 연결할 선생님을 선택해주세요.", values };
      }
      if (error.code === "TEACHER_NOT_AVAILABLE") {
        return { formError: "선택한 선생님을 계정에 연결할 수 없습니다. 활성 상태와 기존 연결을 확인해주세요.", values };
      }
      if (error.code === "SUPER_ADMIN_FORBIDDEN") {
        return { formError: "최고관리자 계정은 일반 경로로 생성할 수 없습니다.", values };
      }
      return { formError: "초대 관리 권한을 다시 확인해주세요.", values };
    }
    if (isUniqueConstraintError(error)) {
      return { formError: "이미 사용 중인 이메일입니다.", values };
    }
    console.error("[invitations] failed to issue invitation");
    return { formError: "초대 발급에 실패했습니다. 잠시 후 다시 시도해주세요.", values };
  }
  revalidatePath("/invitations");
  return { success: true };
}

export async function cancelInvitation(
  _previousState: InvitationRowActionState,
  formData: FormData,
): Promise<InvitationRowActionState> {
  const principal = await requireInvitationPrincipal();
  const invitationId = readFormString(formData, "invitationId");
  if (!invitationId) return { formError: "초대를 찾을 수 없습니다." };
  try {
    await cancelInvitationCore(principal, invitationId);
  } catch (error) {
    if (error instanceof InvitationError) {
      return { formError: invitationErrorMessage(error) };
    }
    console.error("[invitations] failed to cancel invitation");
    return { formError: "초대 해지에 실패했습니다. 잠시 후 다시 시도해주세요." };
  }
  revalidatePath("/invitations");
  return { success: true };
}

export async function reissueInvitation(
  _previousState: InvitationRowActionState,
  formData: FormData,
): Promise<InvitationRowActionState> {
  const principal = await requireInvitationPrincipal();
  const invitationId = readFormString(formData, "invitationId");
  if (!invitationId) return { formError: "초대를 찾을 수 없습니다." };
  try {
    // Reissuance supplies a new token; the previous one is revoked first.
    const issued = await reissueInvitationCore(principal, invitationId);
    const delivery = await deliverIssuedInvitation(issued);
    revalidatePath("/invitations");
    if (delivery !== "ACCEPTED") return { formError: delivery === "FAILED" ? "발송 실패. 새 초대를 재발급해주세요." : "발송 결과를 확인할 수 없습니다. 새 초대를 재발급해주세요." };
  } catch (error) {
    if (error instanceof InvitationError) {
      return { formError: invitationErrorMessage(error) };
    }
    console.error("[invitations] failed to reissue invitation");
    return { formError: "초대 재발급에 실패했습니다. 잠시 후 다시 시도해주세요." };
  }
  revalidatePath("/invitations");
  return { success: true };
}
