"use server";

import { hash } from "bcryptjs";
import { invitationAcceptSchema } from "@/lib/validation/accounts";
import { acceptInvitationCore, InvitationError } from "@/server/accounts/invitations";

/**
 * P3 초대 수락 액션 (공개 라우트 — 세션을 요구하지 않는다).
 * - 비밀번호 정책은 zod로 검증하고, bcrypt cost 12 해시만 코어에 넘긴다.
 * - 실패 원인은 구분하지 않고 하나의 일반 안내만 반환한다 (토큰 상태·계정
 *   존재 여부·모드 누출 방지). 필드 오류(비밀번호 정책)만 구분 표시한다.
 * - 성공 시 자동 로그인하지 않는다. 클라이언트가 로그인 페이지로 안내한다.
 */

export type InvitationAcceptState = {
  errors?: Partial<Record<"password" | "confirmPassword", string[]>>;
  formError?: string;
  success?: boolean;
};

export async function acceptInvitation(
  token: string,
  _previousState: InvitationAcceptState,
  formData: FormData,
): Promise<InvitationAcceptState> {
  const result = invitationAcceptSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }
  try {
    await acceptInvitationCore({ token, passwordHash: await hash(result.data.password, 12) });
  } catch (error) {
    if (error instanceof InvitationError) {
      return {
        formError:
          "초대 수락에 실패했습니다. 링크가 만료·해지되었거나 이미 사용되었을 수 있습니다. 관리자에게 새 초대를 요청해주세요.",
      };
    }
    console.error("[invite] failed to accept invitation");
    return { formError: "초대 수락에 실패했습니다. 잠시 후 다시 시도해주세요." };
  }
  return { success: true };
}
