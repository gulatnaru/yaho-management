import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { formatKstDateTime } from "@/lib/classes/datetime";
import { applicationReviewHref, getApplicationWorkflowDetail } from "@/lib/reservation-applications/detail-queries";
import { familyReturnHref, type ApplicationSearchParams } from "@/lib/reservation-applications/navigation";
import { APPLICATION_STATUS_LABEL, GUARDIAN_RELATIONSHIP_LABEL } from "@/lib/reservation-applications/constants";
import { ApplicationRelatedRecords, ApplicationReviewCard } from "../../_components/application-review-card";
import { ApplicationReviewFocus } from "../../_components/application-review-focus";
import { LedgerSummary } from "../../_components/ledger-summary";
import { DepositForm } from "./deposit-form";
import { SubmissionConfirmationForm } from "./confirmation-form";

export const dynamic = "force-dynamic";
export default async function ApplicationSubmissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<ApplicationSearchParams> }) {
  await requireAdminPrincipal();
  const { id } = await params;
  const context = await searchParams ?? {};
  const detail = await getApplicationWorkflowDetail(id, context.applicationId);
  if (!detail) notFound();
  // Preserve existing confirmation eligibility and props. Read-only review does not add a
  // selection, mutate defaults or use deposit amount as an eligibility shortcut.
  const pending = detail.applications.filter((application) => application.status === "SUBMITTED" && application.childName && application.childBirthDate && application.quotedAmount);
  const confirmed = detail.applications.filter((item) => item.status === "CONFIRMED").length;
  const nextAction = detail.ledger.state !== "available" ? "금액 원장·미확정 금액 기록을 확인하고 다시 조회해주세요." : detail.ledger.R > 0 ? "예약 전 반환이 필요한 기록을 확인해주세요." : pending.length ? "아이별 신청·동의·연결 정보를 검토하고 실제 은행 입금을 확인해주세요." : "아이별 처리 결과와 관련 기록을 확인해주세요.";
  return <section className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
    <header className="space-y-3 rounded-lg border bg-white p-4" data-testid="family-detail-summary"><h1 className="text-2xl font-bold">가족 신청 상세</h1><h2 className="text-xl font-semibold">{detail.personalDataPurgedAt ? "개인정보 파기됨" : detail.guardianName ?? "개인정보 파기됨"}</h2><p className="text-sm">제출 ID {detail.id} · 접수 {formatKstDateTime(detail.submittedAt)} · 아이 {detail.applications.length}명</p><p className="font-medium text-blue-800">다음 할 일: {nextAction}</p><p className="text-sm">신고 입금자 {detail.personalDataPurgedAt ? "개인정보 파기됨" : detail.declaredPayerName ?? "개인정보 파기됨"} · 보호자 입금 알림 {detail.depositNotifiedAt ? formatKstDateTime(detail.depositNotifiedAt) : "없음"}</p><p className="text-sm">실제 입금: {detail.ledger.state === "available" ? detail.ledger.D > 0 ? `확인 누계 ${detail.ledger.D.toLocaleString("ko-KR")}원` : "은행 확인 기록 없음" : "조회·검증 오류"} · 예약 확정 {confirmed}/{detail.applications.length}명</p><p className="text-sm">보호자 연락처: {detail.personalDataPurgedAt ? "개인정보 파기됨" : detail.guardianPhone ?? "기록 없음"} · 관계: {detail.personalDataPurgedAt ? "개인정보 파기됨" : detail.guardianRelationship ? GUARDIAN_RELATIONSHIP_LABEL[detail.guardianRelationship] : "기록 없음"}</p><p className="text-xs text-slate-500">보호자 알림·실제 입금·아이별 예약 확정은 별개입니다.</p><p className="text-sm">{Object.entries(APPLICATION_STATUS_LABEL).map(([status, label]) => { const count = detail.applications.filter((item) => item.status === status).length; return count ? `${label} ${count}명` : ""; }).filter(Boolean).join(" · ")}</p>{detail.personalDataPurgedAt ? <p>가족 개인정보 파기: {formatKstDateTime(detail.personalDataPurgedAt)}</p> : null}</header>
    {detail.invalidApplicationFocus ? <p role="status" className="text-sm text-amber-800">요청한 아이 위치를 확인할 수 없어 이 가족의 전체 신청을 표시합니다.</p> : null}
    <ApplicationReviewFocus applicationId={detail.focusedApplicationId} />
    <section className="space-y-4" aria-labelledby="review-title" data-testid="family-review"><h2 id="review-title" className="text-xl font-semibold">1. 신청·동의·아이 연결 검토</h2><nav aria-label="아이별 신청 검토 이동" className="flex flex-wrap gap-2">{detail.applications.map((item, index) => <Link className="inline-flex min-h-11 items-center rounded border px-3 text-sm underline" key={item.id} href={applicationReviewHref(detail.id, item.id, context)}>{item.childName ?? `아이 ${index + 1} (파기됨)`}</Link>)}</nav>{detail.applications.length ? detail.applications.map((item) => <ApplicationReviewCard key={item.id} application={item} context={context} />) : <p role="alert">이 가족에 연결된 아이 신청 기록을 확인할 수 없습니다.</p>}</section>
    <section className="space-y-4" aria-labelledby="ledger-title" data-testid="family-ledger"><h2 id="ledger-title" className="text-xl font-semibold">2. 실제 입금·반환 원장</h2><LedgerSummary detail={detail} /><div className="space-y-3 rounded border p-4"><h3 className="font-semibold">실제 입금</h3><DepositForm submissionId={detail.id} /></div></section>
    {pending.length > 0 ? <section className="space-y-3" aria-labelledby="confirmation-title" data-testid="family-confirmation"><h2 id="confirmation-title" className="text-xl font-semibold">3. 선택 일괄 확정</h2><p className="text-sm text-slate-500">선택한 아이는 하나의 입금 잔액 검증과 하나의 이체 결제로 함께 확정됩니다.</p>{detail.ledger.state !== "available" ? <p role="alert" className="text-sm text-red-700">원장 가용액을 확인할 수 없습니다. 기록을 다시 확인해주세요. 기존 확정 처리의 서버 검증이 적용됩니다.</p> : null}<SubmissionConfirmationForm submissionId={detail.id} applications={pending.map((application) => ({ id: application.id, childName: application.childName, quotedAmount: application.quotedAmount, candidates: application.confirmationCandidates }))} /></section> : null}
    <ApplicationRelatedRecords applications={detail.applications} />
    <footer className="flex flex-col gap-2 text-sm"><Link className="inline-flex min-h-11 items-center underline" href="/reservation-applications/returns">예약 전 반환 처리 대기 보기</Link><Link className="inline-flex min-h-11 items-center underline" href="/reservation-applications/retention">개인정보 보관·파기 관리</Link><Link className="inline-flex min-h-11 items-center underline" href={familyReturnHref("submission", id, context)}>신청 목록으로</Link></footer>
  </section>;
}
