import { prisma } from "@/lib/db/prisma";

export type ProgramCandidate = {
  id: string;
  name: string;
};

export type TeacherCandidate = {
  id: string;
  name: string;
};

/**
 * ADR-018: 클래스 생성/수정 폼의 프로그램 선택 후보 목록.
 * - 기본은 ACTIVE 프로그램만 후보로 노출한다(신규 배정에 비활성 프로그램을 쓸 수 없게 한다).
 * - 수정 화면(currentProgramId 지정)에서 현재 선택된 프로그램이 비활성이어도, 과거 배정을 조용히
 *   사라지게 하지 않기 위해 그 1건만 후보 목록에 병합한다.
 */
export async function listProgramCandidates(currentProgramId?: string): Promise<ProgramCandidate[]> {
  const activePrograms = await prisma.program.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (!currentProgramId || activePrograms.some((program) => program.id === currentProgramId)) {
    return activePrograms;
  }

  const currentProgram = await prisma.program.findUnique({
    where: { id: currentProgramId },
    select: { id: true, name: true },
  });

  if (!currentProgram) {
    return activePrograms;
  }

  return [...activePrograms, currentProgram].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * ADR-018: 클래스 생성/수정 폼의 선생님 배정 후보 목록.
 * - 기본은 isActive 선생님만 후보로 노출한다.
 * - 수정 화면(currentTeacherIds 지정)에서 이미 배정된 선생님 중 비활성인 사람이 있으면, 조용히
 *   목록에서 사라지지 않도록 그 사람들만 병합한다.
 */
export async function listTeacherCandidates(currentTeacherIds: string[] = []): Promise<TeacherCandidate[]> {
  const activeTeachers = await prisma.teacher.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const activeIds = new Set(activeTeachers.map((teacher) => teacher.id));
  const missingIds = currentTeacherIds.filter((id) => !activeIds.has(id));

  if (missingIds.length === 0) {
    return activeTeachers;
  }

  const inactiveCurrentTeachers = await prisma.teacher.findMany({
    where: { id: { in: missingIds } },
    select: { id: true, name: true },
  });

  return [...activeTeachers, ...inactiveCurrentTeachers].sort((a, b) => a.name.localeCompare(b.name));
}
