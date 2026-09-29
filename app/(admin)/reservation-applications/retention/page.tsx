import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { formatKstDate } from "@/lib/classes/datetime";
import { APPLICATION_STATUS_LABEL, PURGED_PERSONAL_DATA_LABEL } from "@/lib/reservation-applications/constants";
import {
  scanPersonalDataRetention,
  type ChildRetentionCandidate,
  type RetentionCandidate,
} from "@/server/reservation-applications/retention";
import { PurgeExpiredButton } from "../_components/purge-expired-button";
import { APPLICATION_STATUS_VARIANT } from "../_components/application-table";

export const dynamic = "force-dynamic";

function CandidateTable({ items, testId }: { items: RetentionCandidate[]; testId: string }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
        해당하는 신청이 없습니다.
      </div>
    );
  }
  return (
    <Table data-testid={testId}>
      <TableHeader>
        <TableRow>
          <TableHead>아이 이름</TableHead>
          <TableHead className="hidden md:table-cell">수업일</TableHead>
          <TableHead>보관 만료일</TableHead>
          <TableHead>상태</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <Link className="font-medium hover:underline" href={`/reservation-applications/${item.id}`}>
                {item.childName ?? PURGED_PERSONAL_DATA_LABEL}
              </Link>
            </TableCell>
            <TableCell className="hidden md:table-cell">{formatKstDate(item.classStartsAt)}</TableCell>
            <TableCell>{item.retention.retainUntil}</TableCell>
            <TableCell>
              <Badge variant={APPLICATION_STATUS_VARIANT[item.status]}>{APPLICATION_STATUS_LABEL[item.status]}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ChildCandidateTable({ items }: { items: ChildRetentionCandidate[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
        해당하는 고객이 없습니다.
      </div>
    );
  }
  return (
    <Table data-testid="retention-purgeable-children">
      <TableHeader>
        <TableRow>
          <TableHead>아이 이름</TableHead>
          <TableHead className="hidden md:table-cell">마지막 예약 수업일</TableHead>
          <TableHead>보관 만료일</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <Link className="font-medium hover:underline" href={`/children/${item.id}`}>
                {item.name}
              </Link>
            </TableCell>
            <TableCell className="hidden md:table-cell">{item.retention.basisDate}</TableCell>
            <TableCell>{item.retention.retainUntil}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * 개인정보 보관기간 관리(ADR-055~057, ADMIN 전용).
 * 미확정·반려·취소 신청은 수업일로부터 1년, 확정 고객 개인정보·동의이력은 마지막 예약 수업일로부터 5년 보관한다.
 */
export default async function ReservationApplicationRetentionPage() {
  await requireAdminPrincipal();
  const scan = await scanPersonalDataRetention(prisma, new Date());

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/reservation-applications">
        신청 목록으로
      </Link>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold">개인정보 보관기간 관리</h1>
        <p className="text-sm text-slate-500">
          예약이 확정되지 않았거나 반려·취소된 신청은 수업일로부터 1년, 확정 고객의 개인정보와 동의이력은 마지막
          예약 수업일로부터 5년 동안 보관합니다. 기간이 지나면 이 화면에서 파기합니다. 계약·결제·환불 거래기록은
          이 기간과 별도로 보존합니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>파기 대상 신청 ({scan.purgeable.length}건)</CardTitle>
          <CardDescription>
            아이·보호자 정보, 아이와의 관계, 요청사항을 지웁니다. 신청 상태, 처리 기록, 동의 여부와 문구 버전은 남습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CandidateTable items={scan.purgeable} testId="retention-purgeable" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>파기 대상 확정 고객 ({scan.purgeableChildren.length}명)</CardTitle>
          <CardDescription>
            아이·보호자 정보를 비식별화하고 동의이력·안전정보·형제/친구 관계와 예약 메모·취소 상세사유를 삭제합니다.
            예약·출결·결제·환불 기록은 매출과 거래기록 보존을 위해 남습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChildCandidateTable items={scan.purgeableChildren} />
        </CardContent>
      </Card>

      <PurgeExpiredButton applicationCount={scan.purgeable.length} childCount={scan.purgeableChildren.length} />

      <Card>
        <CardHeader>
          <CardTitle>먼저 처리가 필요한 신청 ({scan.expiredPending.length}건)</CardTitle>
          <CardDescription>보관기간이 지났지만 처리 대기 중입니다. 반려 또는 취소한 뒤 파기할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <CandidateTable items={scan.expiredPending} testId="retention-expired-pending" />
        </CardContent>
      </Card>
    </section>
  );
}
