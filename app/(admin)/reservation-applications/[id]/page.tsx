import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WarningBanner } from "@/components/ui/warning-banner";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { formatKstDate, formatKstDateTime, formatKstDateTimeRange } from "@/lib/classes/datetime";
import { getClassDisplayStatus } from "@/lib/classes/status";
import {
  APPLICATION_GENDER_LABEL,
  APPLICATION_STATUS_LABEL,
  GUARDIAN_RELATIONSHIP_LABEL,
  PURGED_PERSONAL_DATA_LABEL,
} from "@/lib/reservation-applications/constants";
import {
  getApplicationRetention,
  getReservationApplicationDetail,
  listChildCandidatesForApplication,
} from "@/lib/reservation-applications/queries";
import { toTelHref } from "@/lib/shared/contact";
import { ApplicationConfirmForm, type ApplicationChildOption } from "../_components/application-confirm-form";
import { ApplicationResolveForm } from "../_components/application-resolve-form";
import { APPLICATION_STATUS_VARIANT } from "../_components/application-table";
import { DepositConfirmButton } from "../_components/deposit-confirm-button";

export const dynamic = "force-dynamic";

const CLASS_STATUS_LABEL = { SCHEDULED: "예정", CANCELLED: "취소", ENDED: "완료" } as const;
const RETENTION_BASIS_LABEL = { CLASS_DATE: "수업일로부터 1년", LAST_RESERVED_CLASS_DATE: "마지막 예약 수업일로부터 5년" } as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function AgreementBadge({ agreed, agreedLabel = "동의", declinedLabel = "미동의" }: {
  agreed: boolean;
  agreedLabel?: string;
  declinedLabel?: string;
}) {
  return <Badge variant={agreed ? "success" : "secondary"}>{agreed ? agreedLabel : declinedLabel}</Badge>;
}

export default async function ReservationApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPrincipal();
  const { id } = await params;
  const application = await getReservationApplicationDetail(id);
  if (!application) notFound();

  const isPurged = application.personalDataPurgedAt !== null;
  const isPending = application.status === "SUBMITTED";
  const canConfirm = isPending && application.depositConfirmedAt !== null;
  const classStatus = getClassDisplayStatus(application.classSchedule);
  const retention = await getApplicationRetention(application);
  const candidates =
    canConfirm && application.childName && application.guardianPhone
      ? await listChildCandidatesForApplication({
          childName: application.childName,
          guardianPhone: application.guardianPhone,
        })
      : [];
  const childOptions: ApplicationChildOption[] = candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    birthDateLabel: candidate.birthDate ? formatKstDate(candidate.birthDate) : "미입력",
    guardianPhone: candidate.guardianPhone,
    isActive: candidate.isActive,
    matchLabel:
      candidate.matchesName && candidate.matchesPhone
        ? "이름·연락처 일치"
        : candidate.matchesName
          ? "이름 일치"
          : "연락처 일치",
  }));

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/reservation-applications">
        신청 목록으로
      </Link>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h1 className="break-words text-2xl font-bold">
          {application.childName ?? PURGED_PERSONAL_DATA_LABEL} 예약 신청
        </h1>
        <Badge variant={APPLICATION_STATUS_VARIANT[application.status]}>
          {APPLICATION_STATUS_LABEL[application.status]}
        </Badge>
      </div>

      {application.isPossibleDuplicate ? (
        <WarningBanner>같은 클래스에 같은 아이로 보이는 다른 신청이 있습니다. 중복 여부를 확인해주세요.</WarningBanner>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>신청 내용</CardTitle>
        </CardHeader>
        <CardContent>
          {isPurged ? (
            <p className="text-sm text-slate-600" data-testid="application-purged">
              보관기간이 지나 개인정보를 파기했습니다.
            </p>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="아이 이름">{application.childName}</Field>
              <Field label="생년월일">{application.childBirthDate ? formatKstDate(application.childBirthDate) : "-"}</Field>
              <Field label="성별">{application.childGender ? APPLICATION_GENDER_LABEL[application.childGender] : "-"}</Field>
              <Field label="보호자 이름">{application.guardianName}</Field>
              <Field label="보호자 연락처">
                {application.guardianPhone ? (
                  <a className="hover:underline" href={toTelHref(application.guardianPhone)}>
                    {application.guardianPhone}
                  </a>
                ) : (
                  "-"
                )}
              </Field>
              <Field label="아이와의 관계">
                {application.guardianRelationship ? GUARDIAN_RELATIONSHIP_LABEL[application.guardianRelationship] : "-"}
              </Field>
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-sm text-slate-500">요청사항</dt>
                <dd className="whitespace-pre-wrap break-words">{application.requestNote || "없음"}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>확인 및 동의</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2" data-testid="application-consents">
            <Field label="[필수] 프로그램 안전 및 이용사항">
              <AgreementBadge agreed={application.programTermsAcknowledged} agreedLabel="확인" declinedLabel="미확인" />
            </Field>
            <Field label="[필수] 개인정보 수집·이용">
              <AgreementBadge agreed={application.privacyConsentAgreed} />
            </Field>
            <Field label="[필수] 법정대리인 확인">
              <AgreementBadge agreed={application.legalGuardianConfirmed} agreedLabel="확인" declinedLabel="미확인" />
            </Field>
            <Field label="[선택] 사진·영상 촬영 및 참여 보호자 공유">
              <AgreementBadge agreed={application.photoShareConsentAgreed} />
            </Field>
            <Field label="[선택] 사진·영상 YAHO 홍보 활용">
              <AgreementBadge agreed={application.photoMarketingConsentAgreed} />
            </Field>
            <Field label="[필수] 취소 및 환불규정">
              <AgreementBadge agreed={application.refundTermsAcknowledged} agreedLabel="확인" declinedLabel="미확인" />
            </Field>
            <Field label="동의 문구 버전">{application.consentVersion}</Field>
            <Field label="신청 일시">{formatKstDateTime(application.submittedAt)}</Field>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>신청 클래스</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="프로그램">{application.classSchedule.program.name}</Field>
            <Field label="일시">
              {formatKstDateTimeRange(application.classSchedule.startsAt, application.classSchedule.endsAt)}
            </Field>
            <Field label="장소">{application.classSchedule.location}</Field>
            <Field label="클래스 상태">{CLASS_STATUS_LABEL[classStatus]}</Field>
          </dl>
          <Link className="text-sm hover:underline" href={`/classes/${application.classSchedule.id}`}>
            클래스 상세 보기
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>처리 기록</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            입금 확인:{" "}
            {application.depositConfirmedAt
              ? `${formatKstDateTime(application.depositConfirmedAt)} · ${application.depositConfirmedBy?.name ?? "-"}`
              : "미확인"}
          </p>
          {application.resolvedAt ? (
            <p>
              {APPLICATION_STATUS_LABEL[application.status]}: {formatKstDateTime(application.resolvedAt)} ·{" "}
              {application.resolvedBy?.name ?? "-"}
            </p>
          ) : null}
          {application.resolutionNote ? (
            <p className="whitespace-pre-wrap break-words">사유: {application.resolutionNote}</p>
          ) : null}
          {application.status === "CONFIRMED" && application.child && application.reservationId ? (
            <div className="flex flex-col gap-2 md:flex-row md:gap-4">
              <Link className="hover:underline" href={`/children/${application.child.id}`}>
                아이 상세: {application.child.name}
              </Link>
              <Link className="hover:underline" href={`/reservations/${application.reservationId}`}>
                예약 상세 보기
              </Link>
              <Link className="hover:underline" href={`/payments/new?reservationId=${application.reservationId}`}>
                결제 등록
              </Link>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>개인정보 보관</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm" data-testid="application-retention">
          <p>
            기준: {RETENTION_BASIS_LABEL[retention.basis]} (기준일 {retention.basisDate})
          </p>
          <p>보관 만료일: {retention.retainUntil}</p>
          {application.personalDataPurgedAt ? (
            <p>
              파기: {formatKstDateTime(application.personalDataPurgedAt)} ·{" "}
              {application.personalDataPurgedBy?.name ?? "-"}
            </p>
          ) : null}
          <p className="text-xs text-slate-500">
            확정된 신청은 연결된 아이의 마지막 예약 수업일로부터 5년 보관하고, 그 아이의 개인정보를 파기할 때 함께
            파기합니다. 반려·취소 신청은 사유까지 함께 지웁니다. 파기는{" "}
            <Link className="underline" href="/reservation-applications/retention">
              보관기간 관리
            </Link>
            에서 합니다.
          </p>
        </CardContent>
      </Card>

      {isPending ? (
        <Card>
          <CardHeader>
            <CardTitle>처리하기</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {classStatus !== "SCHEDULED" ? (
              <WarningBanner>
                취소되었거나 종료된 클래스라 예약으로 확정할 수 없습니다. 신청을 반려해주세요.
              </WarningBanner>
            ) : null}
            {canConfirm ? (
              <ApplicationConfirmForm
                applicationId={application.id}
                childOptions={childOptions}
                defaultMemo={application.requestNote ?? ""}
              />
            ) : (
              <DepositConfirmButton applicationId={application.id} />
            )}
            <div className="grid gap-6 border-t border-slate-100 pt-6 md:grid-cols-2">
              <ApplicationResolveForm applicationId={application.id} kind="REJECTED" />
              <ApplicationResolveForm applicationId={application.id} kind="CANCELLED" />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
