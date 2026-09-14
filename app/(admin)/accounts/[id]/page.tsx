import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCOUNT_CHANGE_LABELS, ACCOUNT_ROLE_LABELS, getAccountDetail } from "@/server/accounts/queries";
import { PasswordResetForm } from "../_components/password-reset-form";

type AccountDetailPageProps = { params: Promise<{ id: string }> };

const DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "medium",
  timeStyle: "short",
});

function historyValue(change: {
  type: keyof typeof ACCOUNT_CHANGE_LABELS;
  previousEmail: string | null;
  nextEmail: string | null;
  previousRole: keyof typeof ACCOUNT_ROLE_LABELS | null;
  nextRole: keyof typeof ACCOUNT_ROLE_LABELS | null;
  previousIsActive: boolean | null;
  nextIsActive: boolean | null;
}) {
  if (change.type === "EMAIL_CHANGED") return `${change.previousEmail ?? "–"} → ${change.nextEmail ?? "–"}`;
  if (change.type === "ROLE_CHANGED") {
    return `${change.previousRole ? ACCOUNT_ROLE_LABELS[change.previousRole] : "–"} → ${change.nextRole ? ACCOUNT_ROLE_LABELS[change.nextRole] : "–"}`;
  }
  if (change.type === "ACTIVE_CHANGED") {
    return `${change.previousIsActive ? "활성" : "비활성"} → ${change.nextIsActive ? "활성" : "비활성"}`;
  }
  return null;
}

export default async function AccountDetailPage({ params }: AccountDetailPageProps) {
  const { id } = await params;
  const detail = await getAccountDetail(id);
  if (!detail) notFound();
  const { account, history } = detail;

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/accounts">← 목록으로</Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{account.name}</h1>
          <p className="text-sm text-slate-500">{account.email}</p>
        </div>
        <Link className={buttonVariants()} href={`/accounts/${account.id}/edit`}>계정 수정</Link>
      </div>

      <Card>
        <CardHeader><CardTitle>계정 정보</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><p className="text-sm text-slate-500">역할</p><p>{ACCOUNT_ROLE_LABELS[account.role]}</p></div>
          <div><p className="text-sm text-slate-500">상태</p><Badge variant={account.isActive ? "success" : "secondary"}>{account.isActive ? "활성" : "비활성"}</Badge></div>
          <div><p className="text-sm text-slate-500">연결 선생님</p><p>{account.teacher?.name ?? "–"}</p></div>
          <div><p className="text-sm text-slate-500">비밀번호 상태</p><p>{account.mustChangePassword ? "변경 필요" : "정상"}</p></div>
          <div><p className="text-sm text-slate-500">생성일</p><p>{DATE_FORMATTER.format(account.createdAt)}</p></div>
          <div><p className="text-sm text-slate-500">최근 변경</p><p>{DATE_FORMATTER.format(account.updatedAt)}</p></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>비밀번호 재설정</CardTitle></CardHeader>
        <CardContent><PasswordResetForm accountId={account.id} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>계정 변경 이력</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? <p className="text-sm text-slate-500">기록된 변경 이력이 없습니다.</p> : (
            <ol className="space-y-4">
              {history.map((change) => (
                <li className="border-b border-slate-100 pb-4 last:border-0 last:pb-0" key={change.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{ACCOUNT_CHANGE_LABELS[change.type]}</p>
                    <time className="text-xs text-slate-500" dateTime={change.createdAt.toISOString()}>{DATE_FORMATTER.format(change.createdAt)}</time>
                  </div>
                  {historyValue(change) ? <p className="mt-1 break-words text-sm text-slate-700">{historyValue(change)}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">처리 관리자: {change.actorAdmin.name} ({change.actorAdmin.email})</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
