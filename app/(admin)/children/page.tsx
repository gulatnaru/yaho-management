import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { listChildren } from "@/lib/children/queries";
import type { ChildListStatus } from "@/lib/children/query-builder";
import { ChildSearchForm } from "./_components/child-search-form";
import { ChildTable } from "./_components/child-table";

export const dynamic = "force-dynamic";

interface ChildrenPageProps {
  searchParams: Promise<{ q?: string; status?: string; birthDate?: string; page?: string }>;
}

function parseStatus(value?: string): ChildListStatus {
  return value === "all" || value === "inactive" ? value : "active";
}

function buildPageHref(params: { q?: string; status: ChildListStatus; birthDate?: string; page: number }) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.status !== "all") query.set("status", params.status);
  if (params.birthDate) query.set("birthDate", params.birthDate);
  query.set("page", String(params.page));
  return `/children?${query.toString()}`;
}

export default async function ChildrenPage({ searchParams }: ChildrenPageProps) {
  const resolvedParams = await searchParams;
  const status = parseStatus(resolvedParams.status);
  const page = resolvedParams.page ? Number.parseInt(resolvedParams.page, 10) || 1 : 1;

  const { children, total, page: currentPage, totalPages } = await listChildren({
    q: resolvedParams.q,
    status,
    birthDate: resolvedParams.birthDate,
    page,
  });

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">아이 관리</h1>
        <Link className={buttonVariants()} href="/children/new">
          아이 등록
        </Link>
      </div>

      <ChildSearchForm birthDate={resolvedParams.birthDate} q={resolvedParams.q} status={status} />

      <p className="text-sm text-slate-500">총 {total}명</p>

      <ChildTable items={children} />

      {totalPages > 1 ? (
        <nav className="flex items-center justify-center gap-4 text-sm">
          {currentPage > 1 ? (
            <Link
              className="text-slate-600 hover:underline"
              href={buildPageHref({ q: resolvedParams.q, status, birthDate: resolvedParams.birthDate, page: currentPage - 1 })}
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
              href={buildPageHref({ q: resolvedParams.q, status, birthDate: resolvedParams.birthDate, page: currentPage + 1 })}
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
