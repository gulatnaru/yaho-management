import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { listPrograms } from "@/lib/programs/queries";
import type { ProgramListStatus } from "@/lib/programs/query-builder";
import { ProgramSearchForm } from "./_components/program-search-form";
import { ProgramTable } from "./_components/program-table";

export const dynamic = "force-dynamic";

interface ProgramsPageProps {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}

function parseStatus(value?: string): ProgramListStatus {
  return value === "all" || value === "inactive" ? value : "active";
}

function buildPageHref(params: { q?: string; status: ProgramListStatus; page: number }) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.status !== "all") query.set("status", params.status);
  query.set("page", String(params.page));
  return `/programs?${query.toString()}`;
}

export default async function ProgramsPage({ searchParams }: ProgramsPageProps) {
  const resolvedParams = await searchParams;
  const status = parseStatus(resolvedParams.status);
  const page = resolvedParams.page ? Number.parseInt(resolvedParams.page, 10) || 1 : 1;

  const { programs, total, page: currentPage, totalPages } = await listPrograms({
    q: resolvedParams.q,
    status,
    page,
  });

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">프로그램 관리</h1>
        <Link className={buttonVariants()} href="/programs/new">
          프로그램 등록
        </Link>
      </div>

      <ProgramSearchForm q={resolvedParams.q} status={status} />

      <p className="text-sm text-slate-500">총 {total}개</p>

      <ProgramTable items={programs} />

      {totalPages > 1 ? (
        <nav className="flex items-center justify-center gap-4 text-sm">
          {currentPage > 1 ? (
            <Link
              className="text-slate-600 hover:underline"
              href={buildPageHref({ q: resolvedParams.q, status, page: currentPage - 1 })}
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
              href={buildPageHref({ q: resolvedParams.q, status, page: currentPage + 1 })}
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
