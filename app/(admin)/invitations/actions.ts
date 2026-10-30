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
import { AccountMutationError } from "@/server/accounts/mutations";

/**
 * P3 관리자 초대 액션 (SUPER_ADMIN 전용 + INVALID 거부 — requireInvitationPrincipal).
 * 모드 가드를 재사용하지 않는다 (게이트 7).
 *
 * 원본 토큰 취급: issueInvitationCore가 반환하는 원본 토큰은 이 액션에서
 * 버린다 (반환·렌더링·로그 일절 없음). P3에는 발송 경로가 없으므로 토큰을
 * 수신자에게 전달할 방법이 없으며, 이는 의도된 구조적 차단이다 (P4 연결 전
 * 사용 전환 금지). P4에서 발송 인터페이스로 전달하는 지점이 여기이다.
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
    // P3: 원본 토큰은 발송 경로가 없어 전달할 수 없다. 반환값을 버리고
    // 성공 여부만 반환한다 (화면·로그에 원본을 노출하지 않는다).
    const { token: _discarded } = await issueInvitationCore(principal, result.data);
    void _discarded;
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
    // P3: 재발급 원본 토큰도 발송 경로가 없어 전달할 수 없다. 버린다.
    const { token: _discarded } = await reissueInvitationCore(principal, invitationId);
    void _discarded;
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
