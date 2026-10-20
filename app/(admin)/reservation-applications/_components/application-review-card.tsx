import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatKstDate, formatKstDateTime, formatKstDateTimeRange } from "@/lib/classes/datetime";
import { APPLICATION_GENDER_LABEL, APPLICATION_STATUS_LABEL } from "@/lib/reservation-applications/constants";
import { applicationReviewAnchor, type ApplicationReview } from "@/lib/reservation-applications/detail-queries";
import { familyDetailHref, type ApplicationSearchParams } from "@/lib/reservation-applications/navigation";

const historyType = { PRIVACY: "개인정보", SENSITIVE_INFO: "민감정보", PHOTO_SHARE: "사진 공유", PHOTO_MARKETING: "홍보 활용" };
const historyAction = { AGREED: "동의", REVOKED: "철회", DECLINED: "미동의 (정상 신청)" };
export function ApplicationReviewCard({ application: item, context }: { application: ApplicationReview; context: ApplicationSearchParams }) {
  const results = [
    ["프로그램 안전 및 이용사항", true, item.programTermsAcknowledged],
    ["개인정보 수집·이용", true, item.privacyConsentAgreed],
    ["법정대리인 확인", true, item.legalGuardianConfirmed],
    ["취소 및 환불규정", true, item.refundTermsAcknowledged],
    ["사진·영상 촬영 및 참여 보호자 공유", false, item.photoShareConsentAgreed],
    ["사진·영상 YAHO 홍보 활용", false, item.photoMarketingConsentAgreed],
  ] as const;
  return <section id={applicationReviewAnchor(item.id)} tabIndex={-1} aria-labelledby={`title-${item.id}`} className="scroll-mt-4 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" data-testid="application-review-card">
    <Card className="min-w-0 [overflow-wrap:anywhere]">
      <CardHeader><CardTitle id={`title-${item.id}`}>{item.childName ?? "개인정보 파기됨"} 신청 검토</CardTitle><Badge>{APPLICATION_STATUS_LABEL[item.status]}</Badge></CardHeader>
      <CardContent className="space-y-5">
        {item.isPurged ? <p data-testid="review-purged">보관기간이 지나 개인정보를 파기했습니다.</p> : <dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-sm text-slate-500">생년월일</dt><dd>{item.childBirthDate ? formatKstDate(item.childBirthDate) : "기록 없음"}</dd></div><div><dt className="text-sm text-slate-500">성별</dt><dd>{item.childGender ? APPLICATION_GENDER_LABEL[item.childGender] : "기록 없음"}</dd></div></dl>}
        <div className="space-y-1 text-sm"><Link className="underline" href={`/classes/${item.classScheduleId}`}>{item.classSchedule.program.name} · 클래스 상세</Link><p>{formatKstDateTimeRange(item.classSchedule.startsAt, item.classSchedule.endsAt)}</p><p>{item.classSchedule.location}</p><p>신청 당시 고정 참가비: {item.quotedAmount !== null && Number.isSafeInteger(item.quotedAmount) && item.quotedAmount > 0 ? `${item.quotedAmount.toLocaleString("ko-KR")}원` : "미확정 금액 · 기록 확인 필요"}</p></div>
        <div><h3 className="font-semibold">보호자 요청사항 원문</h3><p className="whitespace-pre-wrap text-sm">{item.isPurged ? "개인정보 파기로 원문을 제공하지 않습니다." : item.requestNote || "작성하지 않음"}</p><p className="mt-1 text-xs text-slate-500">예약 운영 메모와 별도인 제출 원문입니다. 건강·알레르기 등 민감한 내용을 예약 메모에 자동으로 옮기지 않습니다.</p></div>
        <div className="space-y-2" data-testid="review-consents"><h3 className="font-semibold">신청 당시 확인 및 동의</h3><dl className="space-y-2 text-sm">{results.map(([label, required, agreed]) => <div key={label}><dt>[{required ? "필수" : "선택"}] {label}</dt><dd>{agreed ? "동의·확인" : required ? "미동의·미확인" : "미동의 (정상 신청)"}</dd></div>)}</dl><p className="text-sm">동의 문구 버전: {item.consentVersion} · 신청일시 {formatKstDateTime(item.submittedAt)}</p>
          {item.consentOriginal ? <details className="rounded border p-3"><summary className="min-h-11 cursor-pointer py-2">동의 문구 원문 보기</summary><div className="space-y-4 text-sm">{item.consentOriginal.items.map((consent) => <section key={consent.key}><h4 className="font-semibold">[{consent.required ? "필수" : "선택"}] {consent.title}</h4><p>{consent.checkLabel}</p>{consent.body.map((line) => <p className="mt-1 whitespace-pre-wrap" key={line}>{line}</p>)}</section>)}</div></details> : <p role="status" className="text-sm text-amber-800">이 버전의 동의 원문을 확인할 수 없습니다. 현재 문구를 당시 원문으로 대신 표시하지 않습니다.</p>}
          <details className="rounded border p-3"><summary className="min-h-11 cursor-pointer py-2">연결된 아이의 동의 이력 보기</summary>{item.consentHistory?.length ? <ul className="space-y-2 text-sm">{item.consentHistory.map((record) => <li key={record.id}>{formatKstDateTime(record.recordedAt)} · {historyType[record.consentType]} · {historyAction[record.action]} · 버전 {record.consentVersion ?? "기록 없음"}</li>)}</ul> : <p className="text-sm">{item.isPurged ? "개인정보 파기로 동의 이력을 제공하지 않습니다." : item.childId ? "연결된 아이의 동의 이력을 확인할 수 없습니다." : "아직 아이 연결 전이므로 연결된 아이의 동의 이력이 없습니다."}</p>}</details>
        </div>
        <div className="space-y-2 text-sm"><h3 className="font-semibold">기존 아이 연결 후보 (참고용)</h3><p>후보 열람은 연결·정보 덮어쓰기·예약 확정을 수행하지 않습니다.</p>{item.requestedChildPurgedAt ? <p>보호자가 선택했던 아이의 개인정보가 파기되었습니다: {formatKstDateTime(item.requestedChildPurgedAt)}</p> : null}{item.reviewCandidates.length ? <ul>{item.reviewCandidates.map((child) => <li key={child.id}><Link className="underline" href={`/children/${child.id}`}>{child.name} · {child.birthDate ? formatKstDate(child.birthDate) : "생년월일 미입력"} · {APPLICATION_GENDER_LABEL[child.gender]}</Link>{child.isRequested ? " · 보호자가 선택한 아이" : ""}</li>)}</ul> : <p>{item.isPurged ? "파기된 개인정보로 후보를 조회하지 않습니다." : "기존 연결 조건에 일치하는 활성 아이 후보가 없습니다."}</p>}</div>
        <div className="space-y-1 text-sm"><h3 className="font-semibold">처리 기록</h3><p>신청: {formatKstDateTime(item.submittedAt)}</p><p>입금 확인: {item.depositConfirmedAt ? `${formatKstDateTime(item.depositConfirmedAt)} · ${item.depositConfirmedBy?.name ?? "기록 없음"}` : "아이별 확인 기록 없음 (가족 실제 입금은 원장 참조)"}</p>{item.resolvedAt ? <p>{APPLICATION_STATUS_LABEL[item.status]}: {formatKstDateTime(item.resolvedAt)} · {item.resolvedBy?.name ?? "기록 없음"}</p> : <p>처리 상태: {APPLICATION_STATUS_LABEL[item.status]}</p>}{item.resolutionNote ? <p className="whitespace-pre-wrap">처리 사유: {item.resolutionNote}</p> : null}</div>
        <div className="space-y-1 text-sm" data-testid="review-retention"><h3 className="font-semibold">개인정보 보관·파기</h3><p>{item.retention.basis === "CLASS_DATE" ? "수업일로부터 1년" : "마지막 예약 수업일로부터 5년"} · 기준일 {item.retention.basisDate} · 보관 만료일 {item.retention.retainUntil}</p><p>{item.personalDataPurgedAt ? `파기일시 ${formatKstDateTime(item.personalDataPurgedAt)} · ${item.personalDataPurgedBy?.name ?? "처리자 기록 없음"}` : item.isPurged ? "가족 개인정보 파기 상태" : "개인정보 보관 중"}</p><Link className="inline-flex min-h-11 items-center underline" href="/reservation-applications/retention">보관기간·파기 관리 보기</Link></div>
        <div className="text-sm"><Link className="inline-flex min-h-11 items-center underline" href={familyDetailHref("legacy", item.id, context)}>아이별 신청 상세 및 기존 처리 화면</Link></div>
      </CardContent>
    </Card>
  </section>;
}

/** Actual linked records follow the existing confirmation surface in document order. */
export function ApplicationRelatedRecords({ applications }: { applications: readonly ApplicationReview[] }) {
  return <section className="min-w-0 space-y-4 [overflow-wrap:anywhere]" aria-labelledby="related-title" data-testid="family-related-records">
    <h2 id="related-title" className="text-xl font-semibold">4. 관련 기록</h2>
    {applications.map((item, index) => <article className="space-y-2 rounded border p-4 text-sm" aria-labelledby={`related-${item.id}`} key={item.id}>
      <h3 id={`related-${item.id}`} className="font-semibold">{item.childName ?? `아이 ${index + 1} (개인정보 파기됨)`} · 신청 {item.id}</h3>
      {item.child ? <Link className="inline-flex min-h-11 items-center underline" href={`/children/${item.child.id}`}>연결된 아이 상세</Link> : null}
      {item.reservation ? <div className="space-y-2"><Link className="inline-flex min-h-11 items-center underline" href={`/reservations/${item.reservation.id}`}>연결된 예약 상세</Link><p className="whitespace-pre-wrap">예약 운영 메모: {item.isPurged ? "개인정보 파기로 제공하지 않습니다." : item.reservation.memo || "작성하지 않음"}</p>{item.reservation.paymentItem ? <div><Link className="underline" href={`/payments/${item.reservation.paymentItem.paymentId}`}>연결된 결제 상세</Link>{item.reservation.paymentItem.refunds.length ? <ul>{item.reservation.paymentItem.refunds.map((refund) => <li key={refund.id}><Link className="underline" href={`/payments/${item.reservation!.paymentItem!.paymentId}`}>확정 후 환불 {refund.id} · {refund.amount.toLocaleString("ko-KR")}원 · {refund.status} · {formatKstDateTime(refund.refundedAt)}</Link></li>)}</ul> : null}<p className="text-xs text-slate-500">확정 후 환불은 예약 전 반환·가용액과 별개입니다.</p></div> : <p>연결된 결제 기록 없음</p>}</div> : <p>연결된 예약 없음</p>}
    </article>)}
  </section>;
}
