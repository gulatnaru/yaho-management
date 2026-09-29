import Link from "next/link";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import {
  parseApplicationListPage,
  parseApplicationListStatus,
  type ApplicationListStatus,
} from "@/lib/reservation-applications/list";
import { listReservationApplications } from "@/lib/reservation-applications/queries";
import { ApplicationStatusFilter } from "./_components/application-status-filter";
import { ApplicationTable } from "./_components/application-table";

export const dynamic = "force-dynamic";

interface ReservationApplicationsPageProps {
  searchParams: Promise<{ status?: string; page?: string }>;
}

function buildPageHref(status: ApplicationListStatus, page: number) {
  const query = new URLSearchParams();
  if (status !== "SUBMITTED") query.set("status", status);
  query.set("page", String(page));
  return `/reservation-applications?${query.toString()}`;
}

export default async function ReservationApplicationsPage({ searchParams }: ReservationApplicationsPageProps) {
  await requireAdminPrincipal();
  const resolvedParams = await searchParams;
  const status = parseApplicationListStatus(resolvedParams.status);
  const { applications, total, page, totalPages } = await listReservationApplications({
    status,
    page: parseApplicationListPage(resolvedParams.page),
  });

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">예약 신청</h1>
        <p className="text-sm text-slate-500">
          신청은 아직 예약이 아닙니다. 입금을 확인한 뒤 신청 상세에서 예약으로 확정합니다.
        </p>
      </div>

      <ApplicationStatusFilter status={status} />

      <p className="text-sm text-slate-500">총 {total}건</p>

      <ApplicationTable items={applications} />

      {totalPages > 1 ? (
        <nav className="flex items-center justify-center gap-4 text-sm">
          {page > 1 ? (
            <Link className="text-slate-600 hover:underline" href={buildPageHref(status, page - 1)}>
              이전
            </Link>
          ) : (
            <span className="text-slate-300">이전</span>
          )}
          <span className="text-slate-500">
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link className="text-slate-600 hover:underline" href={buildPageHref(status, page + 1)}>
              다음
            </Link>
          ) : (
            <span className="text-slate-300">다음</span>
          )}
        </nav>
      ) : null}
    </section>
  );
}
