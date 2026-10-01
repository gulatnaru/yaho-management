import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { readPublicApplicationConfig } from "@/lib/reservation-applications/config";
import { cn } from "@/lib/utils";

// 배포 설정(환경변수)을 요청 시점에 읽는다.
export const dynamic = "force-dynamic";

/**
 * 신청 완료 안내(ADR-052). 확정 전 안내, 무통장 입금 계좌, YAHO 채널 링크만 보여준다.
 * 입금 금액·기한·입금자명·취소·환불 안내와 신청 내용(개인정보)은 표시하지 않는다.
 */
export default function ReservationApplicationCompletePage() {
  const config = readPublicApplicationConfig();

  return (
    <section className="space-y-6">
      <Card>
        <CardContent className="space-y-2 p-6">
          <h1 className="text-xl font-bold">신청이 접수되었습니다</h1>
          <p className="text-sm text-slate-700">
            아직 예약이 확정된 것은 아닙니다. 입금과 운영자 확인 후 예약이 확정됩니다.
          </p>
        </CardContent>
      </Card>

      {config ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>무통장 입금 안내</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-slate-500">은행</dt>
                  <dd className="break-words text-right font-medium">{config.bankName}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-slate-500">계좌번호</dt>
                  <dd className="select-all break-all text-right font-medium">{config.bankAccountNumber}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-slate-500">예금주</dt>
                  <dd className="break-words text-right font-medium">{config.bankAccountHolder}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>YAHO 채널</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {[
                { href: config.blogUrl, label: "YAHO 블로그" },
                { href: config.instagramUrl, label: "YAHO Instagram" },
                { href: config.kakaoChannelUrl, label: "YAHO 카카오톡 채널" },
              ].map((channel) => (
                <a
                  className={cn(buttonVariants(), "w-full")}
                  href={channel.href}
                  key={channel.label}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {channel.label}
                </a>
              ))}
            </CardContent>
          </Card>
        </>
      ) : null}
    </section>
  );
}
