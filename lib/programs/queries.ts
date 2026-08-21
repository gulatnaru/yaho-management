import { prisma } from "@/lib/db/prisma";
import { buildProgramListWhere, type ProgramListStatus } from "@/lib/programs/query-builder";

export const PROGRAM_LIST_PAGE_SIZE = 20;

export type ListProgramsParams = {
  q?: string;
  status: ProgramListStatus;
  page?: number;
};

const PROGRAM_LIST_SELECT = {
  id: true,
  name: true,
  targetAgeMin: true,
  targetAgeMax: true,
  status: true,
} as const;

export async function listPrograms(params: ListProgramsParams) {
  const where = buildProgramListWhere({ q: params.q, status: params.status });
  const page = params.page && params.page > 0 ? params.page : 1;

  const [programs, total] = await Promise.all([
    prisma.program.findMany({
      where,
      select: PROGRAM_LIST_SELECT,
      orderBy: { name: "asc" },
      skip: (page - 1) * PROGRAM_LIST_PAGE_SIZE,
      take: PROGRAM_LIST_PAGE_SIZE,
    }),
    prisma.program.count({ where }),
  ]);

  return {
    programs,
    total,
    page,
    pageSize: PROGRAM_LIST_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PROGRAM_LIST_PAGE_SIZE)),
  };
}

export async function getProgramDetail(id: string) {
  return prisma.program.findUnique({
    where: { id },
  });
}
