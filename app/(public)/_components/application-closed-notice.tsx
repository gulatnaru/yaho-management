import { Card, CardContent } from "@/components/ui/card";
import { APPLICATION_CLOSED_MESSAGE } from "@/lib/reservation-applications/constants";

/** 무효·중지·마감 링크 모두 같은 문구만 보여준다. 사유와 클래스 존재 여부를 드러내지 않는다(ADR-052). */
export function ApplicationClosedNotice() {
  return (
    <Card>
      <CardContent className="p-6 text-center">
        <p className="font-medium" data-testid="application-closed">
          {APPLICATION_CLOSED_MESSAGE}
        </p>
      </CardContent>
    </Card>
  );
}
