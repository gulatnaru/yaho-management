import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), readClass: vi.fn(), readLinks: vi.fn(), readGroups: vi.fn(), readSettings: vi.fn(), findLink: vi.fn(), findOpenLink: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: mocks.admin }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  classSchedule: { findUnique: mocks.readClass }, reservationApplicationGroup: { findMany: mocks.readGroups },
  reservationApplicationLink: { findMany: mocks.readLinks, findUnique: mocks.findLink, findFirst: mocks.findOpenLink },
  reservationApplicationSettings: { findUnique: mocks.readSettings },
} }));
const { getClassApplicationLinks } = await import("@/lib/reservation-applications/link-queries");
const { loadPublicApplicationView } = await import("@/lib/reservation-applications/public-queries");
const { issueApplicationLinkCore } = await import("@/server/reservation-applications/links");
const { readClassLinkRevision, LinkRevisionConflictError } = await import("@/server/reservation-applications/groups");

beforeEach(() => { vi.resetAllMocks(); });

it("recovers the stored legacy reissue address from class detail after a lost result, blocks the old address, and refuses a second rotation", async () => {
  const now = new Date();
  const schedule = { id: "class-1", status: "SCHEDULED", startsAt: new Date(now.getTime() + 86400000), endsAt: new Date(now.getTime() + 90000000), updatedAt: now, applicationPrice: null, program: { name: "합성 프로그램" } };
  const oldToken = "o".repeat(32); const newToken = "n".repeat(32);
  let stored = { id: "legacy-1", classScheduleId: schedule.id, groupId: null, token: oldToken, isActive: true, issuedAt: now, updatedAt: now, issuedBy: { name: "합성 관리자" } };
  mocks.admin.mockResolvedValue({ role: "ADMIN" });
  mocks.readClass.mockResolvedValue(schedule); mocks.readGroups.mockResolvedValue([]); mocks.readSettings.mockResolvedValue(null);
  mocks.readLinks.mockImplementation(async () => [{ ...stored }]);
  mocks.findLink.mockImplementation(async ({ where }: { where: { token: string } }) => where.token === stored.token ? { isActive: stored.isActive, classSchedule: schedule } : null);
  mocks.findOpenLink.mockImplementation(async ({ where }: { where: { token: string } }) => where.token === stored.token ? { classSchedule: schedule } : null);
  const update = vi.fn(async ({ data }: { data: Partial<typeof stored> }) => { stored = { ...stored, ...data }; });
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: schedule.id }]),
    classSchedule: { findUnique: mocks.readClass },
    reservationApplicationGroup: { findMany: mocks.readGroups, findFirst: vi.fn(async () => null) },
    reservationApplicationLink: { findMany: mocks.readLinks, findUnique: vi.fn(async () => ({ ...stored })), update },
  };
  const client = { $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) };
  const context = { now, environmentAllowed: true, configReady: true, consentReady: true };
  const revision = await readClassLinkRevision(tx as never, schedule.id);
  expect((await getClassApplicationLinks(schedule.id))?.scopes[0]?.links[0]?.rawPath).toBe(`/apply/${oldToken}`);
  const input = { classScheduleId: schedule.id, revision, actorUserId: "admin-1", now, generateToken: () => newToken };
  // Intentionally discard the core result, as with an empty action response or lost response.
  await issueApplicationLinkCore(client as never, input);
  mocks.readLinks.mockRejectedValueOnce(new Error("SYNTHETIC_REFRESH_FAILURE"));
  await expect(getClassApplicationLinks(schedule.id)).rejects.toThrow("SYNTHETIC_REFRESH_FAILURE");
  const recovered = await getClassApplicationLinks(schedule.id);
  expect(recovered?.revision).not.toBe(revision);
  expect(recovered?.scopes[0]?.links[0]?.rawPath).toBe(`/apply/${newToken}`);
  expect(JSON.stringify(recovered)).not.toContain(oldToken);
  await expect(loadPublicApplicationView(oldToken, context)).resolves.toEqual({ open: false });
  await expect(loadPublicApplicationView(newToken, context)).resolves.toMatchObject({ open: true });
  await expect(issueApplicationLinkCore(client as never, input)).rejects.toBeInstanceOf(LinkRevisionConflictError);
  expect(update).toHaveBeenCalledTimes(1); expect(stored.token).toBe(newToken);
});
