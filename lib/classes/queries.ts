import { prisma } from "@/lib/db/prisma";
import { buildClassListWhere, type ClassListParams } from "@/lib/classes/query-builder";

export const CLASS_LIST_PAGE_SIZE = 20;

export type ListClassesParams = ClassListParams & {
  page?: number;
};

// Phase 6(보험/안전정보) 소유 필드 — insured/insurer/insurancePolicyNo/safetyMemo 는
// 절대 select 하지 않는다. 목록/상세 모두 select 를 명시적으로 나열해 스코프 누출을 막는다.
const CLASS_LIST_SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  program: {
    select: { id: true, name: true },
  },
  teachers: {
    select: {
      teacher: {
        select: { id: true, name: true },
      },
    },
  },
} as const;

export async function listClasses(params: ListClassesParams) {
  const where = buildClassListWhere(params);
  const page = params.page && params.page > 0 ? params.page : 1;

  const [classes, total] = await Promise.all([
    prisma.classSchedule.findMany({
      where,
      select: CLASS_LIST_SELECT,
      orderBy: { startsAt: "asc" },
      skip: (page - 1) * CLASS_LIST_PAGE_SIZE,
      take: CLASS_LIST_PAGE_SIZE,
    }),
    prisma.classSchedule.count({ where }),
  ]);

  return {
    classes,
    total,
    page,
    pageSize: CLASS_LIST_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / CLASS_LIST_PAGE_SIZE)),
  };
}

const CLASS_DETAIL_SELECT = {
  id: true,
  programId: true,
  startsAt: true,
  endsAt: true,
  location: true,
  capacity: true,
  status: true,
  memo: true,
  cancelledAt: true,
  cancelReason: true,
  cancelDetail: true,
  cancelledById: true,
  createdAt: true,
  updatedAt: true,
  program: {
    select: { id: true, name: true, status: true },
  },
  teachers: {
    select: {
      id: true,
      teacherId: true,
      teacher: {
        select: { id: true, name: true, phone: true, isActive: true },
      },
    },
  },
  cancelledBy: {
    select: { id: true, name: true },
  },
} as const;

export async function getClassDetail(id: string) {
  return prisma.classSchedule.findUnique({
    where: { id },
    select: CLASS_DETAIL_SELECT,
  });
}
