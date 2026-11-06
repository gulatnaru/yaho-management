import { listAvailableInvitationTeachers, listInvitations } from "@/server/accounts/invitation-queries";
import { InvitationForm } from "./_components/invitation-form";
import { InvitationTable } from "./_components/invitation-table";

export const dynamic = "force-dynamic";

/**
 * P3 직원 초대 관리 (ADMIN 또는 SUPER_ADMIN — 쿼리가 가드한다, 단순화 결정 ADR-071).
 * 원본 토큰은 이 화면에 표시하지 않는다 (P4 발송 연결 전 사용 전환 금지).
 */
export default async function InvitationsPage() {
  const [invitations, teachers] = await Promise.all([listInvitations(), listAvailableInvitationTeachers()]);

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">직원 초대</h1>
        <p className="mt-1 text-sm text-slate-500">
          일반 직원 계정의 초대를 발급·해지·재발급합니다. 초대 링크는 72시간 동안 1회만 유효합니다.
        </p>
      </div>
      <div>
        <h2 className="text-lg font-semibold">초대 발급</h2>
        <div className="mt-3 max-w-xl">
          <InvitationForm teachers={teachers} />
        </div>
      </div>
      <div>
        <h2 className="text-lg font-semibold">초대 목록</h2>
        <p className="mt-1 text-sm text-slate-500">총 {invitations.length}개</p>
        <div className="mt-3">
          <InvitationTable invitations={invitations} />
        </div>
      </div>
    </section>
  );
}
