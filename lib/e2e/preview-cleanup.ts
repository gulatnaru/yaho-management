import { Prisma } from "@prisma/client";

export type PreviewRunCleanupReport = { runId: string; marker: string; remaining: Record<string, number> };

export class PreviewRunCleanupError extends Error {
  constructor(readonly report: PreviewRunCleanupReport) {
    super("Preview E2E synthetic data cleanup left identifiable rows");
    this.name = "PreviewRunCleanupError";
  }
}

type Delegate = { findMany(args: unknown): Promise<Array<{ id: string }>>; deleteMany(args: unknown): Promise<{ count: number }>; };
type CleanupTransaction = {
  program: Delegate; teacher: Delegate; classSchedule: Delegate; classTeacher: Delegate;
  child: Delegate; childSafetyInfo: Delegate; childConsent: Delegate; relationship: Delegate; reservation: Delegate;
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};
export type PreviewCleanupClient = CleanupTransaction & { $transaction<T>(callback: (transaction: CleanupTransaction) => Promise<T>): Promise<T>; };

function ids(rows: Array<{ id: string }>) { return rows.map((row) => row.id); }
function markerForRun(runId: string) {
  if (!/^preview-[a-z0-9-]+$/i.test(runId)) throw new Error("Invalid Preview E2E run ID");
  return `E2E_P11_${runId}_`;
}

async function discover(client: CleanupTransaction, runId: string) {
  const marker = markerForRun(runId);
  const [programs, teachers, classes, children] = await Promise.all([
    client.program.findMany({ where: { name: { contains: marker } }, select: { id: true } }),
    client.teacher.findMany({ where: { name: { contains: marker } }, select: { id: true } }),
    client.classSchedule.findMany({ where: { location: { contains: marker } }, select: { id: true } }),
    client.child.findMany({ where: { name: { contains: marker } }, select: { id: true } }),
  ]);
  const classIds = ids(classes); const childIds = ids(children); const teacherIds = ids(teachers);
  const [classTeachers, allClassTeachers, safetyInfos, allSafetyInfos, reservations, allReservations, consents, relationships] = await Promise.all([
    client.classTeacher.findMany({ where: { classScheduleId: { in: classIds }, teacherId: { in: teacherIds } }, select: { id: true } }),
    client.classTeacher.findMany({ where: { classScheduleId: { in: classIds } }, select: { id: true } }),
    client.childSafetyInfo.findMany({ where: { OR: [{ allergies: { contains: marker } }, { emergencyNotes: { contains: marker } }, { emergencyContactName: { contains: marker } }, { emergencyContactPhone: { contains: marker } }] }, select: { id: true } }),
    client.childSafetyInfo.findMany({ where: { childId: { in: childIds } }, select: { id: true } }),
    client.reservation.findMany({ where: { memo: { contains: marker } }, select: { id: true } }),
    client.reservation.findMany({ where: { OR: [{ classScheduleId: { in: classIds } }, { childId: { in: childIds } }] }, select: { id: true } }),
    client.childConsent.findMany({ where: { childId: { in: childIds } }, select: { id: true } }),
    client.relationship.findMany({ where: { OR: [{ childAId: { in: childIds } }, { childBId: { in: childIds } }] }, select: { id: true } }),
  ]);
  return { marker, programs, teachers, classes, children, classTeachers, allClassTeachers, safetyInfos, allSafetyInfos, reservations, allReservations, consents, relationships };
}
function notOwned(all: Array<{ id: string }>, owned: Array<{ id: string }>) { const ownedIds = new Set(ids(owned)); return all.filter((row) => !ownedIds.has(row.id)); }
function report(runId: string, resources: Awaited<ReturnType<typeof discover>>): PreviewRunCleanupReport {
  return { runId, marker: resources.marker, remaining: {
    programs: resources.programs.length, teachers: resources.teachers.length, classes: resources.classes.length, children: resources.children.length,
    reservations: resources.reservations.length, safetyInfos: resources.safetyInfos.length,
    unownedClassTeachers: notOwned(resources.allClassTeachers, resources.classTeachers).length,
    unownedSafetyInfos: notOwned(resources.allSafetyInfos, resources.safetyInfos).length,
    unownedReservations: notOwned(resources.allReservations, resources.reservations).length,
    unownedConsents: resources.consents.length, unownedRelationships: resources.relationships.length,
  } };
}
function hasValues(values: Record<string, number>) { return Object.values(values).some((value) => value > 0); }
function hasUnowned(values: Record<string, number>) { return Object.entries(values).some(([key, value]) => key.startsWith("unowned") && value > 0); }
async function lockRoots(client: CleanupTransaction, resources: Awaited<ReturnType<typeof discover>>) {
  const locks: Array<[string, string[]]> = [["Program", ids(resources.programs)], ["Teacher", ids(resources.teachers)], ["ClassSchedule", ids(resources.classes)], ["Child", ids(resources.children)]];
  for (const [table, rootIds] of locks) if (rootIds.length) await client.$queryRaw`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id IN (${Prisma.join(rootIds)}) FOR UPDATE`;
}

/** Checks every cascade path under row locks before deleting only this run's rows. */
export async function cleanupPreviewRun(client: PreviewCleanupClient, runId: string): Promise<PreviewRunCleanupReport> {
  return client.$transaction(async (transaction) => {
    const roots = await discover(transaction, runId);
    await lockRoots(transaction, roots);
    const resources = await discover(transaction, runId);
    const before = report(runId, resources);
    if (hasUnowned(before.remaining)) throw new PreviewRunCleanupError(before);
    try {
      await transaction.reservation.deleteMany({ where: { id: { in: ids(resources.reservations) } } });
      await transaction.childSafetyInfo.deleteMany({ where: { id: { in: ids(resources.safetyInfos) } } });
      await transaction.classTeacher.deleteMany({ where: { id: { in: ids(resources.classTeachers) } } });
      await transaction.classSchedule.deleteMany({ where: { id: { in: ids(resources.classes) } } });
      await transaction.child.deleteMany({ where: { id: { in: ids(resources.children) } } });
      await transaction.teacher.deleteMany({ where: { id: { in: ids(resources.teachers) } } });
      await transaction.program.deleteMany({ where: { id: { in: ids(resources.programs) } } });
    } catch {
      throw new PreviewRunCleanupError(report(runId, await discover(transaction, runId)));
    }
    const after = report(runId, await discover(transaction, runId));
    if (hasValues(after.remaining)) throw new PreviewRunCleanupError(after);
    return after;
  });
}

export async function runWithPreviewCleanup<T>({ runId, run, cleanup, onCleanupFailure }: { runId: string; run: () => Promise<T>; cleanup: () => Promise<PreviewRunCleanupReport>; onCleanupFailure: (report: PreviewRunCleanupReport) => void; }): Promise<T> {
  try { return await run(); } finally {
    try { await cleanup(); } catch (error) {
      onCleanupFailure(error instanceof PreviewRunCleanupError ? error.report : {
        runId,
        marker: markerForRun(runId),
        remaining: {},
      });
      throw error;
    }
  }
}
