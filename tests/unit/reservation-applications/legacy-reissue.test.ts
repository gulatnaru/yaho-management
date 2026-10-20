import { expect, it, vi } from "vitest";
import { issueApplicationLinkCore, stopApplicationLinkCore } from "@/server/reservation-applications/links";
import { LinkRevisionConflictError, readClassLinkRevision } from "@/server/reservation-applications/groups";
import { ApplicationLinkNotFoundError } from "@/lib/reservation-applications/errors";
const now = new Date("2026-10-20");
function fixture() {
  const link = { id: "legacy", token: "old-opaque", groupId: null as string | null, isActive: true, updatedAt: now };
  let upgraded = false;
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: "class" }]),
    classSchedule: { findUnique: vi.fn(async () => ({ id: "class", updatedAt: now, status: "SCHEDULED", startsAt: new Date("2099-01-01"), applicationPrice: null })) },
    reservationApplicationGroup: { findMany: async () => [], findFirst: async () => upgraded ? { id: "upgraded" } : null },
    reservationApplicationLink: {
      findMany: async () => [{ id: link.id, isActive: link.isActive, updatedAt: link.updatedAt }],
      findUnique: async () => ({ ...link }),
      updateMany: vi.fn(async ({ data }) => { Object.assign(link, data); return { count: 1 }; }),
      update: vi.fn(async ({ data }) => Object.assign(link, data)),
    },
  };
  let queue = Promise.resolve();
  const client = { $transaction: (callback: (value: typeof tx) => Promise<unknown>) => {
    const result = queue.then(() => callback(tx)); queue = result.then(() => undefined, () => undefined); return result;
  } };
  const revision = () => readClassLinkRevision(tx as never, "class");
  const issue = (revision: string) => issueApplicationLinkCore(client as never, { classScheduleId: "class", actorUserId: "admin", now, revision, generateToken: () => "new-opaque" });
  return { client, link, tx, issue, revision, upgrade: () => { upgraded = true; } };
}
it("explicit amount-free Phase 18 reissue changes only its existing raw-token row", async () => {
  const f = fixture(); const revision = await f.revision();
  expect(await f.issue(revision)).toEqual({ token: "new-opaque" });
  expect(f.link).toMatchObject({ id: "legacy", token: "new-opaque", groupId: null, isActive: true });
  expect(f.link.updatedAt.getTime()).toBe(now.getTime() + 1); expect(await f.revision()).not.toBe(revision);
  expect(Object.keys(f.tx)).not.toContain("reservationApplicationSettings");
});
it("concurrent duplicate reissue and lost-response frozen retry cannot rotate twice", async () => {
  const f = fixture(); const revision = await f.revision();
  const results = await Promise.allSettled([f.issue(revision), f.issue(revision)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(LinkRevisionConflictError);
  await expect(f.issue(revision)).rejects.toBeInstanceOf(LinkRevisionConflictError); expect(f.tx.reservationApplicationLink.update).toHaveBeenCalledOnce();
});
it("never recreates plaintext storage after upgrade", async () => {
  const f = fixture(); f.upgrade();
  await expect(f.issue(await f.revision())).rejects.toBeInstanceOf(ApplicationLinkNotFoundError); expect(f.tx.reservationApplicationLink.update).not.toHaveBeenCalled();
});

it("fixed-clock stop/reissue cycles never revive a frozen legacy revision", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  try {
    const f = fixture(); await f.issue(await f.revision());
    const frozen = await f.revision();
    await stopApplicationLinkCore(f.client as never, { classScheduleId: "class", revision: frozen });
    await f.issue(await f.revision());
    await expect(f.issue(frozen)).rejects.toBeInstanceOf(LinkRevisionConflictError);
    await expect(stopApplicationLinkCore(f.client as never, { classScheduleId: "class", revision: frozen })).rejects.toBeInstanceOf(LinkRevisionConflictError);
    expect(f.link.isActive).toBe(true); expect(f.link.updatedAt.getTime()).toBe(now.getTime() + 3);
  } finally { vi.useRealTimers(); }
});
