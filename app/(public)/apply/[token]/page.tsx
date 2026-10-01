import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKstDateTimeRange } from "@/lib/classes/datetime";
import { formatTargetAgeRange } from "@/lib/programs/format";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { loadPublicApplicationView } from "@/lib/reservation-applications/public-queries";
import { buildApplicationAvailabilityContext } from "@/lib/reservation-applications/runtime";
import { ApplicationClosedNotice } from "../../_components/application-closed-notice";
import { ReservationApplicationForm } from "./_components/reservation-application-form";
import { submitReservationApplication } from "./actions";

// 링크 상태·클래스 상태·설정을 요청마다 다시 판정한다.
export const dynamic = "force-dynamic";

export default async function ReservationApplicationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // 접수 판정용 최소 조회를 먼저 하고, 열린 링크일 때만 클래스 표시 정보를 조회한다.
  // 닫힌 링크의 응답(HTML·RSC payload)에는 장소·프로그램 정보가 실리지 않는다(ADR-052).
  const view = await loadPublicApplicationView(token, buildApplicationAvailabilityContext(new Date()));

  // 무효·중지·마감·설정 미비를 구분하지 않고 같은 안내만 보여준다(ADR-052).
  if (!view.open) {
    return <ApplicationClosedNotice />;
  }

  const { classSchedule } = view;
  const { program } = classSchedule;

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">예약 신청</h1>
        <p className="text-sm text-slate-600">
          신청 후 입금과 운영자 확인을 거쳐 예약이 확정됩니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="break-words">{program.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {program.description ? (
            <p className="whitespace-pre-wrap break-words text-slate-700">{program.description}</p>
          ) : null}
          <dl className="grid gap-3">
            <div>
              <dt className="text-slate-500">일시</dt>
              <dd className="font-medium">{formatKstDateTimeRange(classSchedule.startsAt, classSchedule.endsAt)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">장소</dt>
              <dd className="break-words font-medium">{classSchedule.location}</dd>
            </div>
            <div>
              <dt className="text-slate-500">대상 연령</dt>
              <dd className="font-medium">{formatTargetAgeRange(program.targetAgeMin, program.targetAgeMax)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <ReservationApplicationForm
        action={submitReservationApplication.bind(null, token)}
        consentItems={APPLICATION_CONSENT_CONTENT.items}
      />
    </section>
  );
}
