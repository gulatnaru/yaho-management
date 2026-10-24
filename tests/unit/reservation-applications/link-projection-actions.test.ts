import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), view: vi.fn(), options: vi.fn(), group: vi.fn(), revision: vi.fn() }));
vi.mock("@/server/reservation-applications/groups", () => ({ readClassLinkRevision: mocks.revision }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: mocks.admin }));
vi.mock("@/lib/reservation-applications/link-queries", () => ({ getClassApplicationLinks: mocks.view, getLinkCompositionOptions: mocks.options }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { reservationApplicationGroup: { findUnique: mocks.group } } }));
const { readClassLinkProjection, readGroupLinkProjection } = await import("@/app/(admin)/classes/link-projection-actions");

beforeEach(() => { vi.resetAllMocks(); mocks.admin.mockResolvedValue({ userId: "synthetic-admin" }); });

it.each([readClassLinkProjection, readGroupLinkProjection])("authorizes before reading or parsing", async (read) => {
  mocks.admin.mockRejectedValueOnce(new Error("DENIED"));
  await expect(read("synthetic")).rejects.toThrow("DENIED");
  expect(mocks.view).not.toHaveBeenCalled(); expect(mocks.options).not.toHaveBeenCalled(); expect(mocks.group).not.toHaveBeenCalled();
});
it.each([undefined, null, "", "x".repeat(201), { groupId: "synthetic" }])("rejects malformed record identities before DB reads", async (input) => {
  await expect(readClassLinkProjection(input)).rejects.toThrow();
  await expect(readGroupLinkProjection(input)).rejects.toThrow();
  expect(mocks.view).not.toHaveBeenCalled(); expect(mocks.options).not.toHaveBeenCalled(); expect(mocks.group).not.toHaveBeenCalled();
});
it("returns the existing authoritative ADMIN card and composition projection together", async () => {
  mocks.view.mockResolvedValue({ applicationPrice: 65000, priceRevision: "next-price", revision: "next-link" });
  mocks.options.mockResolvedValue([{ id: "class", revision: "next-link" }]);
  expect(await readClassLinkProjection("class")).toEqual({ view: { applicationPrice: 65000, priceRevision: "next-price", revision: "next-link" }, options: [{ id: "class", revision: "next-link" }] });
  expect(mocks.view).toHaveBeenCalledWith("class"); expect(mocks.options).toHaveBeenCalledWith("class");
});
it.each([null, { isActive: false, links: [{ id: "inactive-group-link" }], classes: [] }])("refuses absent/inactive groups despite active-looking link identities", async (group) => {
  mocks.group.mockResolvedValue(group);
  expect(await readGroupLinkProjection("group")).toEqual({ groupId: "group", activeLinkIds: [], members: {} });
});
it("reads active IDs in the exact receipt group without selecting token/hash/PII fields", async () => {
  mocks.group.mockResolvedValue({ isActive: true, links: [{ id: "active-link" }], classes: [{ classScheduleId: "class", classSchedule: { status: "SCHEDULED", startsAt: new Date("2099-01-01"), applicationPrice: 25000 } }] });
  mocks.revision.mockResolvedValue("fresh-link-revision");
  expect(await readGroupLinkProjection("group")).toEqual({ groupId: "group", activeLinkIds: ["active-link"], members: { class: { revision: "fresh-link-revision", applicationPrice: 25000, eligible: true } } });
  expect(mocks.group).toHaveBeenCalledWith({ where: { id: "group" }, select: { isActive: true, links: { where: { isActive: true }, select: { id: true } }, classes: { select: { classScheduleId: true, classSchedule: { select: { status: true, startsAt: true, applicationPrice: true } } } } } });
  expect(mocks.revision).toHaveBeenCalledWith(expect.anything(), "class");
});
