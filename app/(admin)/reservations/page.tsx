import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { listReservations } from "@/lib/reservations/queries";
import { parseReservationListStatus, type ReservationListStatus } from "@/lib/reservations/query-builder";
import { ReservationSearchForm } from "./_components/reservation-search-form";
import { ReservationTable } from "./_components/reservation-table";

export const dynamic = "force-dynamic";

interface ReservationsPageProps {
  searchParams: Promise<{
    childName?: string;
    programName?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: string;
    page?: string;
  }>;
}

function buildPageHref(params: {
  childName?: string;
  programName?: string;
  dateFrom?: string;
  dateTo?: string;
  status: ReservationListStatus;
  page: number;
}) {
  const query = new URLSearchParams();
  if (params.childName) query.set("childName", params.childName);
  if (params.programName) query.set("programName", params.programName);
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  if (params.status !== "RESERVED") query.set("status", params.status);
  query.set("page", String(params.page));
  return `/reservations?${query.toString()}`;
}

export default async function ReservationsPage({ searchParams }: ReservationsPageProps) {
  const resolvedParams = await searchParams;
  const status = parseReservationListStatus(resolvedParams.status);
  const page = resolvedParams.page ? Number.parseInt(resolvedParams.page, 10) || 1 : 1;

  const {
    reservations,
    total,
    page: currentPage,
    totalPages,
  } = await listReservations({
    childName: resolvedParams.childName,
    programName: resolvedParams.programName,
    dateFrom: resolvedParams.dateFrom,
    dateTo: resolvedParams.dateTo,
    status,
    page,
  });

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">예약 관리</h1>
        <Link className={buttonVariants()} href="/reservations/new">
          예약 등록
        </Link>
      </div>

      <ReservationSearchForm
        childName={resolvedParams.childName}
        dateFrom={resolvedParams.dateFrom}
        dateTo={resolvedParams.dateTo}
        programName={resolvedParams.programName}
        status={status}
      />

      <p className="text-sm text-slate-500">총 {total}건</p>

      <ReservationTable items={reservations} />

      {totalPages > 1 ? (
        <nav className="flex items-center justify-center gap-4 text-sm">
          {currentPage > 1 ? (
            <Link
              className="text-slate-600 hover:underline"
              href={buildPageHref({
                childName: resolvedParams.childName,
                programName: resolvedParams.programName,
                dateFrom: resolvedParams.dateFrom,
                dateTo: resolvedParams.dateTo,
                status,
                page: currentPage - 1,
              })}
            >
              이전
            </Link>
          ) : (
            <span className="text-slate-300">이전</span>
          )}
          <span className="text-slate-500">
            {currentPage} / {totalPages}
          </span>
          {currentPage < totalPages ? (
            <Link
              className="text-slate-600 hover:underline"
              href={buildPageHref({
                childName: resolvedParams.childName,
                programName: resolvedParams.programName,
                dateFrom: resolvedParams.dateFrom,
                dateTo: resolvedParams.dateTo,
                status,
                page: currentPage + 1,
              })}
            >
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
