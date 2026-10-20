import Link from "next/link";
import type { LinkReadiness as Readiness } from "@/lib/reservation-applications/availability";

export const LINK_ISSUANCE_LABEL = { NONE: "미발급", ACTIVE: "링크 활성", STOPPED: "링크 비활성 · 접수 중지" } as const;
const INTAKE_LABEL = { READY: "클래스 접수 조건 충족", CANCELLED: "취소된 클래스 · 신규 접수 불가", STARTED: "시작 시각 경과 · 신규 접수 불가", PRICE_MISSING: "신청금액 미설정", OUTSIDE_SCOPE: "현재 링크 대상에서 제외된 클래스" } as const;

/** Five separate diagnostics; none implies another environment's availability. */
export function LinkReadiness({ readiness }: { readiness: Readiness }) {
  return <dl className="space-y-2 break-words text-sm" data-testid="link-readiness">
    <div><dt className="font-medium">링크 발급·활성</dt><dd>{LINK_ISSUANCE_LABEL[readiness.issuance]}</dd></div>
    <div><dt className="font-medium">클래스 접수 조건</dt><dd>{INTAKE_LABEL[readiness.classIntake]}</dd></div>
    <div><dt className="font-medium">입금 안내·동의 문구</dt><dd>{readiness.guideReady ? "입금 안내 준비됨" : "입금 안내 설정 필요"} · {readiness.consentReady ? "동의 문구 준비됨" : "동의 문구 준비 필요"}</dd></div>
    <div><dt className="font-medium">현재 환경</dt><dd>{readiness.environment}</dd></div>
    <div><dt className="font-medium">현재 환경 일반 공개 접근</dt><dd>{readiness.publicAccessAllowed ? "환경 제한 없음 · 링크와 접수 조건은 별도 확인" : "일반 보호자 신청 제한 · 링크 중지와 별개"}</dd></div>
  </dl>;
}

export function LinkReadinessIssues({ readiness, classScheduleId }: { readiness: Readiness; classScheduleId?: string }) {
  return <div className="space-y-2 text-sm">
    {readiness.accessRestriction === "SYNTHETIC" ? <p>합성 테스트 링크는 운영 환경에서 접수할 수 없습니다.</p> : null}
    {readiness.issuance === "STOPPED" ? <p>관리자가 이 링크의 신규 신청을 중지했습니다. 기존 신청과 예약은 유지됩니다.</p> : null}
    {readiness.classIntake !== "READY" ? <p>{INTAKE_LABEL[readiness.classIntake]}{readiness.classIntake === "PRICE_MISSING" ? <> · <Link className="underline" href={classScheduleId ? `/classes/${encodeURIComponent(classScheduleId)}/edit` : "/classes"}>클래스 정보에서 신청금액을 확인해 주세요.</Link></> : null}</p> : null}
    {!readiness.guideReady ? <p>입금 안내 설정 필요 · <Link className="underline" href="/reservation-applications/settings">신청 설정 확인</Link>{readiness.environment === "Preview" ? " · 테스트 링크의 안내 설정도 확인해 주세요." : ""}</p> : null}
    {!readiness.consentReady ? <p>동의 문구 준비 필요 · 운영 동의 원문과 미확정 항목을 확인해 주세요.</p> : null}
  </div>;
}
