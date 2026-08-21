import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { listTeachers } from "@/lib/teachers/queries";
import type { TeacherListStatus } from "@/lib/teachers/query-builder";
import { TeacherSearchForm } from "./_components/teacher-search-form";
import { TeacherTable } from "./_components/teacher-table";

export const dynamic = "force-dynamic";

interface TeachersPageProps {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}

function parseStatus(value?: string): TeacherListStatus {
  return value === "all" || value === "inactive" ? value : "active";
}

function buildPageHref(params: { q?: string; status: TeacherListStatus; page: number }) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.status !== "all") query.set("status", params.status);
  query.set("page", String(params.page));
  return `/teachers?${query.toString()}`;
}

export default async function TeachersPage({ searchParams }: TeachersPageProps) {
  const resolvedParams = await searchParams;
  const status = parseStatus(resolvedParams.status);
  const page = resolvedParams.page ? Number.parseInt(resolvedParams.page, 10) || 1 : 1;

  const { teachers, total, page: currentPage, totalPages } = await listTeachers({
    q: resolvedParams.q,
    status,
    page,
  });

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">선생님 관리</h1>
        <Link className={buttonVariants()} href="/teachers/new">
          선생님 등록
        </Link>
      </div>

      <TeacherSearchForm q={resolvedParams.q} status={status} />

      <p className="text-sm text-slate-500">총 {total}명</p>

      <TeacherTable items={teachers} />

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
