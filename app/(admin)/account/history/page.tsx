import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCOUNT_CHANGE_LABELS, ACCOUNT_ROLE_LABELS, listOwnAccountHistory } from "@/server/accounts/queries";

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

/**
 * P2 (OQ-12): 본인 이력 전용 조회 페이지. 읽기 전용이며, 권한 검사는 서버 쿼리
 * (listOwnAccountHistory)에서 수행한다. SUPER_ADMIN·ADMIN·STAFF는 본인 행만 보고,
 * MANAGER·TEACHER는 서버에서 거부된다. 계정 관리 페이지와는 별개 경로이다.
 */
export default async function OwnAccountHistoryPage() {
  const history = await listOwnAccountHistory();

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">내 계정 변경 이력</h1>
        <p className="mt-1 text-sm text-slate-500">본인 계정에 대한 변경 기록만 표시됩니다.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>변경 이력</CardTitle></CardHeader>
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

      <Link className="text-sm text-slate-500 hover:underline" href="/account/password">← 비밀번호 변경으로</Link>
    </section>
  );
}
