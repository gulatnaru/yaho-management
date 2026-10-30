import { getInvitationAcceptanceState } from "@/server/accounts/invitations";
import { AcceptForm } from "../_components/accept-form";

export const dynamic = "force-dynamic";

type InvitePageProps = { params: Promise<{ token: string }> };

/**
 * P3 초대 수락 페이지 (공개 라우트 — 세션을 요구하지 않는다).
 * - 토큰이 유효한 대기 상태일 때만 비밀번호 설정 폼을 노출한다.
 * - 무효·만료·해지·사용済 토큰에는 계정 존재 여부·초대자 정보를 노출하지 않고
 *   하나의 일반 재요청 안내만 표시한다 (상태 구분 문구를 노출하지 않는다).
 * - 이 GET 조회는 상태를 변경하지 않는다. 소비·활성화는 POST 액션에서만 수행한다.
 */
export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const { state } = await getInvitationAcceptanceState(token);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-bold">직원 초대 수락</h1>
      {state === "VALID" ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-slate-500">
            초대 링크가 확인되었습니다. 사용할 비밀번호를 설정하면 계정이 활성화됩니다.
          </p>
          <AcceptForm token={token} />
        </div>
      ) : (
        <p className="mt-6 text-sm text-slate-600" role="status">
          유효하지 않은 초대 링크입니다. 관리자에게 새 초대를 요청해주세요.
        </p>
      )}
    </main>
  );
}
