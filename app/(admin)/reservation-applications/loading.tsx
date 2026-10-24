export default function LoadingApplications() {
  return <section aria-busy="true" aria-live="polite" className="space-y-4"><h1 className="text-2xl font-bold">예약 신청</h1><p role="status">신청을 불러오는 중입니다…</p><div aria-hidden="true" className="h-48 animate-pulse rounded-lg bg-slate-100" /></section>;
}
