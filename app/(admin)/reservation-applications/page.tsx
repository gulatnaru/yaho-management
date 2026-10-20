import Link from "next/link";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { listApplicationFamilies } from "@/lib/reservation-applications/family-queries";
import { familyListHref, type ApplicationSearchParams } from "@/lib/reservation-applications/navigation";
import { ApplicationStatusFilter } from "./_components/application-status-filter";
import { FamilyApplicationCard } from "./_components/family-application-card";

export const dynamic = "force-dynamic";
export default async function ReservationApplicationsPage({ searchParams }: { searchParams: Promise<ApplicationSearchParams> }) {
  await requireAdminPrincipal();
  const result = await listApplicationFamilies(await searchParams);
  const { families, filters, page, totalPages } = result;
  return <section className="min-w-0 space-y-6">
    <div className="space-y-2"><h1 className="text-2xl font-bold">예약 신청</h1><p className="text-sm text-slate-600">전역 대기 {result.globalPending.families}가족 · 대기 아이 신청 {result.globalPending.childApplications}건</p><p className="text-sm text-slate-500">신청은 아직 예약이 아닙니다. 신청 내용을 확인하고 실제 입금을 기록한 뒤 예약을 확정합니다.</p>
      <nav aria-label="신청 관리" className="flex flex-wrap gap-x-4 gap-y-2 text-sm underline"><Link href="/reservation-applications/retention">개인정보 보관기간 관리</Link><Link href="/reservation-applications/groups">신청 그룹 관리</Link><Link href="/reservation-applications/settings">운영 설정</Link><Link href="/reservation-applications/returns">반환 처리</Link></nav>
    </div>
    <p className="text-sm">조건에 맞는 {result.totalFamilies}가족 · 해당 가족 전체 아이 신청 {result.totalChildApplications}건 · 조건 일치 아이 신청 {result.matchingChildApplications}건</p>
    <ApplicationStatusFilter filters={filters} />
    {families.length ? <div className="space-y-4">{families.map((family) => <FamilyApplicationCard family={family} filters={filters} key={`${family.kind}:${family.id}`} />)}</div> : <div className="rounded-lg border p-6 text-center"><p>{result.totalUnfilteredFamilies === 0 ? "접수된 신청이 없습니다" : "조건에 맞는 신청이 없습니다"}</p>{result.totalUnfilteredFamilies > 0 ? <Link className="inline-flex min-h-11 items-center text-sm underline" href="/reservation-applications?status=all">필터 초기화</Link> : null}</div>}
    {totalPages > 1 ? <nav aria-label="가족 신청 페이지" className="flex items-center justify-center gap-4 text-sm">{page > 1 ? <Link className="inline-flex min-h-11 items-center underline" href={familyListHref({ ...filters, page: page - 1 })}>이전 페이지</Link> : null}<span>{page} / {totalPages}</span>{page < totalPages ? <Link className="inline-flex min-h-11 items-center underline" href={familyListHref({ ...filters, page: page + 1 })}>다음 페이지</Link> : null}</nav> : null}
  </section>;
}
