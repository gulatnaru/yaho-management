import { prisma } from "@/lib/db/prisma";
import { buildTeacherListWhere, type TeacherListStatus } from "@/lib/teachers/query-builder";

export const TEACHER_LIST_PAGE_SIZE = 20;

export type ListTeachersParams = {
  q?: string;
  status: TeacherListStatus;
  page?: number;
};

const TEACHER_LIST_SELECT = {
  id: true,
  name: true,
  phone: true,
  isActive: true,
} as const;

export async function listTeachers(params: ListTeachersParams) {
  const where = buildTeacherListWhere({ q: params.q, status: params.status });
  const page = params.page && params.page > 0 ? params.page : 1;

  const [teachers, total] = await Promise.all([
    prisma.teacher.findMany({
      where,
      select: TEACHER_LIST_SELECT,
      orderBy: { name: "asc" },
      skip: (page - 1) * TEACHER_LIST_PAGE_SIZE,
      take: TEACHER_LIST_PAGE_SIZE,
    }),
    prisma.teacher.count({ where }),
  ]);

  return {
    teachers,
    total,
    page,
    pageSize: TEACHER_LIST_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / TEACHER_LIST_PAGE_SIZE)),
  };
}

export async function getTeacherDetail(id: string) {
  return prisma.teacher.findUnique({
    where: { id },
  });
}
