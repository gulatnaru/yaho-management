import { describe, expect, it, vi } from "vitest";
import { classLinkOperationIdentity, classLinkOperationSchema, issueClassLinkOperationCore, linkRevision, readClassLinkRevision, LinkOperationConflictError, LinkRevisionConflictError, LinkSettingsNotReadyError, type ClassLinkOperation } from "@/server/reservation-applications/groups";
import { ApplicationLinkClassClosedError } from "@/lib/reservation-applications/errors";

const now = new Date("2026-10-20T00:00:00Z");
const settings = { bankName: "은행", accountNumber: "123", accountHolder: "예금주", blogUrl: "https://example.test/blog", instagramUrl: "https://example.test/photo", kakaoChannelUrl: "https://example.test/chat" };
const actor = "admin-1";
type Group = { id: string; isActive: boolean; updatedAt: Date; classes: { classScheduleId: string }[]; links: { id: string; isActive: boolean; updatedAt: Date }[] };
type Link = { id: string; groupId: string; tokenHash: string; isActive: boolean; updatedAt: Date };
function fixture() {
  const schedules = ["class-1", "class-2"].map((id) => ({ id, applicationPrice: 20000 as number | null, status: "SCHEDULED", startsAt: new Date("2027-01-01"), updatedAt: now }));
  const groups: Group[] = [];
  const links: Link[] = [];
  const project = (group: Group) => ({ ...group, links: links.filter((row) => row.groupId === group.id).map(({ id, isActive, updatedAt }) => ({ id, isActive, updatedAt })).sort((a,b) => a.id.localeCompare(b.id)) });
  const tx = {
    $queryRaw: vi.fn(async (query: TemplateStringsArray) => query.join("").includes('"ClassSchedule"') ? schedules.map(({ id }) => ({ id })) : [{ id: "group" }]),
    classSchedule: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => schedules.find((row) => row.id === where.id)), findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => schedules.filter((row) => where.id.in.includes(row.id))) },
    reservationApplicationGroup: {
      findMany: vi.fn(async ({ where }: { where: { OR: { classes?: { some: { classScheduleId: string } } }[] } }) => groups.filter((group) => group.classes.some((row) => row.classScheduleId === where.OR[0]!.classes!.some.classScheduleId)).map(project)),
      findFirst: vi.fn(async ({ where }: { where: { id: { startsWith: string } } }) => groups.find((row) => row.id.startsWith(where.id.startsWith)) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const group = groups.find((row) => row.id === where.id); return group ? project(group) : null; }),
      create: vi.fn(async ({ data }: { data: { id: string } }) => { groups.push({ id: data.id, isActive: true, updatedAt: now, classes: [], links: [] }); return { id: data.id }; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { isActive: boolean } }) => { Object.assign(groups.find((row) => row.id === where.id)!, data); }),
    },
    reservationApplicationGroupClass: { createMany: vi.fn(async ({ data }: { data: { groupId: string; classScheduleId: string }[] }) => { for (const row of data) groups.find((group) => group.id === row.groupId)!.classes.push({ classScheduleId: row.classScheduleId }); }) },
    reservationApplicationLink: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async ({ where }: { where: { id: { startsWith: string } } }) => links.find((row) => row.id.startsWith(where.id.startsWith)) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => links.find((row) => row.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Link }) => { links.push({ ...data, updatedAt: now }); }),
      updateMany: vi.fn(async ({ where }: { where: { groupId: string } }) => { for (const row of links.filter((row) => row.groupId === where.groupId)) row.isActive = false; }),
    },
    reservationApplicationSettings: { findUnique: vi.fn(async () => settings as typeof settings | null) },
  };
  // Deterministic unit adapter only. PostgreSQL tests below own transaction/lock guarantees.
  const client = { $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
    const before = structuredClone({ groups, links });
    try { return await callback(tx); } catch (error) { groups.splice(0, groups.length, ...before.groups); links.splice(0, links.length, ...before.links); throw error; }
  } };
  async function intent(ids = ["class-1"], kind: "single" | "compose" = "single"): Promise<ClassLinkOperation> {
    return { operationId: crypto.randomUUID(), kind, classScheduleIds: ids, revisions: Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await readClassLinkRevision(tx as never, id)]))) };
  }
  const issue = (request: ClassLinkOperation, actorUserId = actor) => issueClassLinkOperationCore(client as never, { ...request, actorUserId, now, generateToken: () => "raw-secret-unique" });
  return { tx, schedules, groups, links, intent, issue, project };
}

it("binds operation identity to actor, UUID, kind, sorted classes and immutable observed revisions", () => {
  const request = classLinkOperationSchema.parse({ operationId: crypto.randomUUID(), kind: "compose", classScheduleIds: ["a", "b"], revisions: { a: "a".repeat(64), b: "b".repeat(64) } });
  expect(classLinkOperationIdentity(actor, request)).toEqual(classLinkOperationIdentity(actor, { ...request, classScheduleIds: ["b", "a"] }));
  expect(classLinkOperationIdentity(actor, request).id).not.toEqual(classLinkOperationIdentity("other-admin", request).id);
  expect(classLinkOperationSchema.safeParse({ ...request, classScheduleIds: ["a", "a"] }).success).toBe(false);
  expect(classLinkOperationSchema.safeParse({ ...request, kind: "replace" }).success).toBe(false);
});

describe("safe class issuance", () => {
  it("issues one class atomically and persists a hash only", async () => {
    const f = fixture(); const request = await f.intent();
    f.tx.$queryRaw.mockImplementation(async (query) => query.join("").includes('"ClassSchedule"') ? [{ id: "class-1" }] : [{ id: "group" }]);
    const result = await f.issue(request);
    expect(result).toMatchObject({ active: true, replayed: false, token: "raw-secret-unique" });
    expect(f.groups).toHaveLength(1); expect(f.groups[0]?.classes).toEqual([{ classScheduleId: "class-1" }]);
    expect(f.links).toHaveLength(1); expect(f.links[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(f.links)).not.toContain("raw-secret");
    const locks = f.tx.$queryRaw.mock.calls.map(([query]) => query.join(""));
    expect(locks[0]).toContain("pg_advisory_xact_lock"); expect(locks[1]).toContain("ClassSchedule");
    expect(f.tx.reservationApplicationGroup.create.mock.invocationCallOrder[0]).toBeLessThan(f.tx.$queryRaw.mock.invocationCallOrder[1]!);
    const replay = await f.issue(request); expect(replay).toMatchObject({ replayed: true, linkId: result.linkId }); expect(replay.token).toBeUndefined();
    expect(f.groups).toHaveLength(1); expect(f.links).toHaveLength(1);
  });
  it("rejects unset price, invalid settings and rolls back all fresh group state", async () => {
    const f = fixture(); f.tx.$queryRaw.mockResolvedValue([{ id: "class-1" }]);
    f.schedules[0]!.applicationPrice = null;
    await expect(f.issue(await f.intent())).rejects.toBeInstanceOf(ApplicationLinkClassClosedError);
    expect(f.groups).toHaveLength(0); expect(f.links).toHaveLength(0);
    f.schedules[0]!.applicationPrice = 20000; f.tx.reservationApplicationSettings.findUnique.mockResolvedValue(null);
    await expect(f.issue(await f.intent())).rejects.toBeInstanceOf(LinkSettingsNotReadyError);
    expect(f.groups).toHaveLength(0);
  });
  it("rejects changed payload on same operation even after membership changes", async () => {
    const f = fixture(); const request = await f.intent(["class-1", "class-2"], "compose"); await f.issue(request);
    f.groups[0]!.classes = [{ classScheduleId: "class-2" }];
    await expect(f.issue({ ...request, classScheduleIds: ["class-1"], revisions: { "class-1": request.revisions["class-1"]! } })).rejects.toBeInstanceOf(LinkOperationConflictError);
    expect((await f.issue(request)).token).toBeUndefined();
  });
  it("rejects stale independent attempts without harming existing or unrelated group links", async () => {
    const f = fixture(); f.tx.$queryRaw.mockResolvedValue([{ id: "class-1" }]);
    const first = await f.intent(); const stale = await f.intent(); await f.issue(first);
    await expect(f.issue(stale, "admin-2")).rejects.toBeInstanceOf(LinkRevisionConflictError);
    const other = await f.issue(await f.intent(["class-2"]));
    expect(f.groups).toHaveLength(2); expect(f.links.every((row) => row.isActive)).toBe(true);
    expect(other.token).toBeDefined();
  });
  it("replaces/stops/resumes only the chosen group and replay never reactivates after a later stop", async () => {
    const f = fixture(); const created = await f.issue(await f.intent(["class-1", "class-2"], "compose"));
    const make = async (kind: "replace" | "stop" | "resume"): Promise<ClassLinkOperation> => ({ ...(await f.intent(["class-1", "class-2"], "compose")), groupId: created.groupId, kind, groupRevision: linkRevision(f.project(f.groups[0]!)) });
    const replace = await make("replace"); const replaced = await f.issue(replace);
    expect(f.links[0]?.isActive).toBe(false); expect(f.links[1]?.isActive).toBe(true);
    await f.issue(await make("stop"));
    const replay = await f.issue(replace); expect(replay).toMatchObject({ linkId: replaced.linkId, active: false, replayed: true }); expect(replay.token).toBeUndefined();
    await f.issue(await make("resume")); expect(f.links.filter((row) => row.isActive)).toHaveLength(1); expect(f.links[0]?.isActive).toBe(false); expect(f.links[1]?.isActive).toBe(false);
  });
  it("keeps existing applications/payment models outside every issuance write", async () => {
    const f = fixture(); await f.issue(await f.intent(["class-1", "class-2"], "compose"));
    expect(f.tx.classSchedule.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.not.objectContaining({ program: expect.anything() }) }));
    expect(Object.keys(f.tx)).not.toContain("reservationApplication"); expect(Object.keys(f.tx)).not.toContain("payment");
  });
  it("re-reads a retry receipt after the group lock when a replacement invalidates its old link", async () => {
    const f = fixture(); f.tx.$queryRaw.mockResolvedValue([{ id: "class-1" }]);
    const request = await f.intent(); const created = await f.issue(request);
    // The optimistic operation lookup sees the old state before waiting for the
    // concurrent writer's group lock; the locked read must supersede it.
    f.tx.reservationApplicationLink.findFirst.mockResolvedValueOnce({ ...f.links[0]! });
    f.tx.$queryRaw.mockImplementation(async (query) => {
      if (query.join("").includes('"ReservationApplicationGroup"')) f.links[0]!.isActive = false;
      return [{ id: "locked" }];
    });
    expect(await f.issue(request)).toMatchObject({ linkId: created.linkId, replayed: true, active: false });
    expect(f.tx.reservationApplicationLink.findUnique).toHaveBeenCalledWith({ where: { id: created.linkId }, select: { id: true, isActive: true } });
  });
  it("fails closed on a lost stop response and cannot stop a later explicitly resumed link", async () => {
    const f = fixture(); f.tx.$queryRaw.mockResolvedValue([{ id: "class-1" }]);
    const created = await f.issue(await f.intent());
    const stop: ClassLinkOperation = { ...(await f.intent()), kind: "stop", groupId: created.groupId, groupRevision: linkRevision(f.project(f.groups[0]!)) };
    await f.issue(stop);
    await expect(f.issue(stop)).rejects.toBeInstanceOf(LinkRevisionConflictError);
    expect(f.groups[0]?.isActive).toBe(false); expect(f.links.every((row) => !row.isActive)).toBe(true);
    const resume: ClassLinkOperation = { ...(await f.intent()), kind: "resume", groupId: created.groupId, groupRevision: linkRevision(f.project(f.groups[0]!)) };
    const resumed = await f.issue(resume);
    await expect(f.issue(stop)).rejects.toBeInstanceOf(LinkRevisionConflictError);
    expect(f.links.find((row) => row.id === resumed.linkId)?.isActive).toBe(true);
  });
});
