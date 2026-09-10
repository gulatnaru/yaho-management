import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { listClasses } from "@/lib/classes/queries";
import { parseClassListStatus } from "@/lib/classes/query-builder";
import {
  buildClassListHref,
  getActiveClassDatePreset,
  getClassDatePresets,
} from "@/server/classes/filter-presets";
import { ClassSearchForm } from "./_components/class-search-form";
import { ClassTable } from "./_components/class-table";

export const dynamic = "force-dynamic";

interface ClassesPageProps {
  searchParams: Promise<{ dateFrom?: string; dateTo?: string; status?: string; page?: string }>;
}

export default async function ClassesPage({ searchParams }: ClassesPageProps) {
  const resolvedParams = await searchParams;
  const status = parseClassListStatus(resolvedParams.status);
  const page = resolvedParams.page ? Number.parseInt(resolvedParams.page, 10) || 1 : 1;
  const presets = getClassDatePresets();
  const activePreset = getActiveClassDatePreset(
    resolvedParams.dateFrom,
    resolvedParams.dateTo,
    presets,
  );

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

      <ClassSearchForm
        activePreset={activePreset}
        dateFrom={resolvedParams.dateFrom}
        dateTo={resolvedParams.dateTo}
        key={`${resolvedParams.dateFrom ?? ""}:${resolvedParams.dateTo ?? ""}:${status}`}
        presetHrefs={{
          today: buildClassListHref({ ...presets.today, status }),
          week: buildClassListHref({ ...presets.week, status }),
          month: buildClassListHref({ ...presets.month, status }),
        }}
        status={status}
      />

      <p className="text-sm text-slate-500">총 {total}건</p>

      <ClassTable
        items={classes.map((classItem) => ({
          id: classItem.id,
          startsAt: classItem.startsAt,
          endsAt: classItem.endsAt,
          status: classItem.status,
          capacity: classItem.capacity,
          reservedCount: classItem._count.reservations,
          program: classItem.program,
        }))}
      />

      {totalPages > 1 ? (
        <nav className="flex items-center justify-center gap-4 text-sm">
          {currentPage > 1 ? (
            <Link
              className="text-slate-600 hover:underline"
              href={buildClassListHref({
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
              href={buildClassListHref({
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
