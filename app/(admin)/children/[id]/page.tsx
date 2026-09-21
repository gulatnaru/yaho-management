import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOperationalPrincipal } from "@/lib/auth/authorization";
import { calculateAge } from "@/lib/children/age";
import { getChildConsentSummary } from "@/lib/children/consent/queries";
import type { ConsentType } from "@/lib/children/consent/validation";
import { getChildDetail } from "@/lib/children/queries";
import { getChildSafetyInfo } from "@/lib/children/safety-info/queries";
import {
  formatKstDate,
  formatKstDateTime,
  formatKstTime,
} from "@/lib/classes/datetime";
import { formatKrw } from "@/lib/payments/format";
import { listPaymentItemsByChild } from "@/lib/payments/queries";
import { toTelHref } from "@/lib/shared/contact";
import { cn } from "@/lib/utils";
import { parseChildHistoryPage } from "@/lib/validation/child-history";
import {
  getChildHistorySummary,
  listChildPastHistory,
  listChildPastHistoryOperational,
  listChildUpcomingReservations,
  listChildUpcomingReservationsOperational,
} from "@/server/children/history";
import { ChildHistorySection } from "./_components/child-history-section";
import { ChildHistorySummaryCards } from "./_components/child-history-summary";
import { ConsentForm } from "./consent-form";
import { ChildStatusToggle } from "../_components/child-status-toggle";
import { PlaceholderSection } from "../_components/placeholder-section";

const CONSENT_TYPES: ConsentType[] = [
  "PRIVACY",
  "SENSITIVE_INFO",
  "PHOTO_SHARE",
  "PHOTO_MARKETING",
];

const CONSENT_LABEL: Record<ConsentType, string> = {
  PRIVACY: "개인정보 수집·이용",
  SENSITIVE_INFO: "민감정보 수집",
  PHOTO_SHARE: "활동 사진 보호자 공유",
  PHOTO_MARKETING: "사진 홍보·마케팅",
};

type ChildDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ChildDetailPage({
  params,
  searchParams,
}: ChildDetailPageProps) {
  const [{ id }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const principal = await requireOperationalPrincipal();
  const isAdmin = principal.role === "ADMIN";
  const historyPage = parseChildHistoryPage(resolvedSearchParams.historyPage);
  const now = new Date();

  const [
    child,
    safetyInfo,
    consent,
    paymentItems,
    historySummary,
    upcomingReservations,
    pastHistory,
  ] = await Promise.all([
    getChildDetail(id),
    getChildSafetyInfo(id),
    getChildConsentSummary(id),
    isAdmin ? listPaymentItemsByChild(id) : Promise.resolve(undefined),
    getChildHistorySummary(id, now),
    isAdmin
      ? listChildUpcomingReservations(id, now)
      : listChildUpcomingReservationsOperational(id, now),
    isAdmin
      ? listChildPastHistory(id, now, historyPage)
      : listChildPastHistoryOperational(id, now, historyPage),
  ]);

  if (!child) notFound();

  const moreHistoryHref = pastHistory.hasMore
    ? `/children/${id}?historyPage=${historyPage + 1}#past-history`
    : undefined;

  return (
    <section className="min-w-0 space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/children">
        아이 목록으로
      </Link>

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="break-words text-2xl font-bold">{child.name}</h1>
        <div className="flex flex-wrap gap-2">
          {child.isActive ? (
            <Link className={cn(buttonVariants())} href={`/reservations/new?childId=${child.id}`}>
              예약 추가
            </Link>
          ) : null}
          <Link className={cn(buttonVariants())} href={`/children/${child.id}/edit`}>
            정보 수정
          </Link>
          <ChildStatusToggle id={child.id} isActive={child.isActive} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-slate-500">생년월일</p>
            <p>
              {child.birthDate
                ? `${child.birthDate.toISOString().slice(0, 10)} (만 ${calculateAge(child.birthDate)}세)`
                : "미입력"}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">성별</p>
            <p>
              {child.gender === "MALE" ? "남아" : child.gender === "FEMALE" ? "여아" : "미지정"}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">보호자</p>
            <p>{child.guardianName ?? "미입력"}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">보호자 연락처</p>
            <p>
              {child.guardianPhone ? (
                <a className="hover:underline" href={toTelHref(child.guardianPhone)}>
                  {child.guardianPhone}
                </a>
              ) : (
                "미입력"
              )}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">상태</p>
            <p>{child.isActive ? "활성" : "비활성"}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">등록일</p>
            <p>{child.registeredAt.toISOString().slice(0, 10)}</p>
          </div>
        </CardContent>
      </Card>

      <ChildHistorySummaryCards summary={historySummary} />
      <ChildHistorySection
        description="앞으로 참여할 수업을 가까운 날짜부터 확인합니다."
        emptyMessage="예정된 클래스가 없습니다."
        id="upcoming-classes"
        items={upcomingReservations}
        now={now}
        showPayment={isAdmin}
        title="예정된 클래스"
      />
      <ChildHistorySection
        description="완료·노쇼·예약 취소·종료·수업 취소 이력을 최근 날짜부터 확인합니다."
        emptyMessage="지난 이력이 없습니다."
        id="past-history"
        items={pastHistory.items}
        moreHref={moreHistoryHref}
        now={now}
        showPayment={isAdmin}
        title="지난 이력"
      />

      <Card>
        <CardHeader>
          <CardTitle>운영 메모</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-slate-700">
            {child.memo || "메모가 없습니다."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>안전 정보</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {safetyInfo ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-slate-500">알레르기 및 주의사항</p>
                <p className="whitespace-pre-wrap">{safetyInfo.allergies || "없음"}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">응급 시 유의사항</p>
                <p className="whitespace-pre-wrap">{safetyInfo.emergencyNotes || "없음"}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">비상연락처</p>
                <p>
                  {safetyInfo.emergencyContactName || "미입력"}{" "}
                  {safetyInfo.emergencyContactRelation
                    ? `(${safetyInfo.emergencyContactRelation})`
                    : ""}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-500">전화번호</p>
                <p>{safetyInfo.emergencyContactPhone || "미입력"}</p>
              </div>
              <div className="text-xs text-slate-500 sm:col-span-2">
                최종 수정: {safetyInfo.updatedBy?.name ?? "알 수 없음"} ·{" "}
                {formatKstDate(safetyInfo.updatedAt)} {formatKstTime(safetyInfo.updatedAt)}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">등록된 안전 정보가 없습니다.</p>
          )}
          <Link
            className={cn(
              buttonVariants(),
              "bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100",
            )}
            href={`/children/${id}/safety`}
          >
            안전 정보 수정
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>동의 현황 및 이력</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {CONSENT_TYPES.map((type) => {
              const record = consent.current.get(type);
              return (
                <div
                  className="flex items-center justify-between rounded-md border p-3 text-sm"
                  key={type}
                >
                  <span>{CONSENT_LABEL[type]}</span>
                  <Badge variant={record?.action === "AGREED" ? "success" : "secondary"}>
                    {record?.action === "AGREED" ? "동의" : record ? "철회" : "미기록"}
                  </Badge>
                </div>
              );
            })}
          </div>
          <ConsentForm childId={id} />
          {consent.history.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                전체 이력 보기 ({consent.history.length})
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {consent.history.map((record) => (
                  <li key={record.id}>
                    {CONSENT_LABEL[record.consentType as ConsentType]} ·{" "}
                    {record.action === "AGREED" ? "동의" : "철회"} ·{" "}
                    {formatKstDateTime(record.recordedAt)} · {record.recordedBy?.name ?? "알 수 없음"}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </CardContent>
      </Card>

      {isAdmin && paymentItems ? (
        <Card>
          <CardHeader>
            <CardTitle>결제·환불 이력</CardTitle>
          </CardHeader>
          <CardContent>
            {paymentItems.length === 0 ? (
              <p className="text-sm text-slate-500">결제 이력이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {paymentItems.map((item) => (
                  <li className="rounded-md border p-3 text-sm" key={item.id}>
                    <div className="flex flex-col justify-between gap-2 sm:flex-row">
                      <Link
                        className="min-w-0 break-words font-medium hover:underline"
                        href={`/payments/${item.payment.id}`}
                      >
                        {item.reservation.classSchedule.program.name}
                      </Link>
                      <span>
                        {formatKrw(item.paidAmount)} 결제 · {formatKrw(item.refundedAmount)} 환불
                      </span>
                    </div>
                    {item.refunds.length > 0 ? (
                      <ul className="mt-2 space-y-1 border-t pt-2 text-xs text-slate-600">
                        {item.refunds.map((refund) => (
                          <li key={refund.id}>
                            {formatKstDateTime(refund.refundedAt)} · {formatKrw(refund.amount)} ·{" "}
                            {refund.reasonDetail || "상세 사유 없음"}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PlaceholderSection description="Phase 7에서 제공 예정" title="친구관계" />
        <PlaceholderSection description="Phase 7에서 제공 예정" title="형제·자매관계" />
      </div>
    </section>
  );
}
