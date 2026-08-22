import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { listClasses } from "@/lib/classes/queries";
import { parseClassListStatus, type ClassListStatus } from "@/lib/classes/query-builder";
import { ClassSearchForm } from "./_components/class-search-form";
import { ClassTable } from "./_components/class-table";

export const dynamic = "force-dynamic";

interface ClassesPageProps {
  searchParams: Promise<{ dateFrom?: string; dateTo?: string; status?: string; page?: string }>;
}

function buildPageHref(params: {
  dateFrom?: string;
  dateTo?: string;
  status: ClassListStatus;
  page: number;
}) {
  const query = new URLSearchParams();
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  if (params.status !== "SCHEDULED") query.set("status", params.status);
  query.set("page", String(params.page));
  return `/classes?${query.toString()}`;
}

export default async function ClassesPage({ searchParams }: ClassesPageProps) {
  const resolvedParams = await searchParams;
  const status = parseClassListStatus(resolvedParams.status);
  const page = resolvedParams.page ? Number.parseInt(resolvedParams.page, 10) || 1 : 1;

  const {
    classes,
    total,
    page: currentPage,
    totalPages,
  } = await listClasses({
    dateFrom: resolvedParams.dateFrom,
    dateTo: resolvedParams.dateTo,
    status,
    page,
  });

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">클래스 일정</h1>
        <Link className={buttonVariants()} href="/classes/new">
          클래스 등록
        </Link>
      </div>

      <ClassSearchForm dateFrom={resolvedParams.dateFrom} dateTo={resolvedParams.dateTo} status={status} />

      <p className="text-sm text-slate-500">총 {total}건</p>

      <ClassTable
        items={classes.map((classItem) => ({
          id: classItem.id,
          startsAt: classItem.startsAt,
          endsAt: classItem.endsAt,
          status: classItem.status,
          program: classItem.program,
        }))}
      />

      {totalPages > 1 ? (
        <nav className="flex items-center justify-center gap-4 text-sm">
          {currentPage > 1 ? (
            <Link
              className="text-slate-600 hover:underline"
              href={buildPageHref({
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
