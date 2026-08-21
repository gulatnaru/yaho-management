import { prisma } from "@/lib/db/prisma";
import { buildChildListWhere, type ChildListStatus } from "@/lib/children/query-builder";

export const CHILD_LIST_PAGE_SIZE = 20;

export type ListChildrenParams = {
  q?: string;
  status: ChildListStatus;
  page?: number;
};

// 목록 조회에서 반환하는 필드. ChildSafetyInfo 는 절대 select/include 하지 않는다 (ADR-006).
const CHILD_LIST_SELECT = {
  id: true,
  name: true,
  birthDate: true,
  guardianName: true,
  guardianPhone: true,
  isActive: true,
} as const;

export async function listChildren(params: ListChildrenParams) {
  const where = buildChildListWhere({ q: params.q, status: params.status });
  const page = params.page && params.page > 0 ? params.page : 1;

  const [children, total] = await Promise.all([
    prisma.child.findMany({
      where,
      select: CHILD_LIST_SELECT,
      orderBy: { name: "asc" },
      skip: (page - 1) * CHILD_LIST_PAGE_SIZE,
      take: CHILD_LIST_PAGE_SIZE,
    }),
    prisma.child.count({ where }),
  ]);

  return {
    children,
    total,
    page,
    pageSize: CHILD_LIST_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / CHILD_LIST_PAGE_SIZE)),
  };
}

// 상세 조회. ChildSafetyInfo 는 절대 select/include 하지 않는다 (ADR-006).
// 친구관계/형제자매관계/예약/결제/환불/안전정보는 Phase 2에서는 placeholder-section 으로만 표시한다 (ADR-011).
export async function getChildDetail(id: string) {
  return prisma.child.findUnique({
    where: { id },
  });
}
