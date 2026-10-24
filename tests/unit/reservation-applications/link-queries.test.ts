import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), classRead: vi.fn(), classes: vi.fn(), links: vi.fn(), groups: vi.fn(), settings: vi.fn(), consent: vi.fn() }));
vi.mock("@/lib/reservation-applications/consent-content", () => ({ isConsentContentReady: mocks.consent }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: mocks.admin }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  classSchedule: { findUnique: mocks.classRead, findMany: mocks.classes }, reservationApplicationLink: { findMany: mocks.links },
  reservationApplicationGroup: { findMany: mocks.groups }, reservationApplicationSettings: { findUnique: mocks.settings },
} }));
const { getClassApplicationLinks, getLinkCompositionOptions } = await import("@/lib/reservation-applications/link-queries");
const NOW = new Date("2026-10-20T01:00:00Z");
const future = new Date("2026-12-01T01:00:00Z");
const settings = { bankName: "은행", accountNumber: "123", accountHolder: "예금주", blogUrl: "https://example.test/blog", instagramUrl: "https://example.test/photo", kakaoChannelUrl: "https://example.test/chat" };
const member = (id = "class-1") => ({ classSchedule: { id, startsAt: future, program: { name: `프로그램 ${id}` } } });
const link = (id: string, isActive = true, token: string | null = null) => ({ id, token, isActive, issuedAt: NOW, issuedBy: { name: "발급자" } });
const group = (id: string, overrides = {}) => ({ id, isActive: true, upgradedLegacyClassScheduleId: null, syntheticRunId: null, syntheticSettings: null, classes: [member()], links: [link(`link-${id}`)], ...overrides });

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  vi.unstubAllEnvs(); vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ role: "ADMIN" }); mocks.consent.mockReturnValue(true);
  mocks.classRead.mockResolvedValue({ id: "class-1", status: "SCHEDULED", startsAt: future, endsAt: new Date("2026-12-01T02:00:00Z"), applicationPrice: 10000, program: { name: "프로그램" } });
  mocks.links.mockResolvedValue([]); mocks.groups.mockResolvedValue([]); mocks.settings.mockResolvedValue(settings);
  mocks.classes.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("complete ADMIN class link inventory", () => {
  it("represents no link without inventing a scope", async () => {
    const result = await getClassApplicationLinks("class-1");
    expect(result?.scopes).toEqual([]);
    expect(result).toMatchObject({ canIssue: true, unissuedReadiness: { issuance: "NONE" } });
    expect(mocks.admin.mock.invocationCallOrder[0]).toBeLessThan(mocks.classRead.mock.invocationCallOrder[0]!);
  });
  it("projects every direct/group link, inactive history, multiple groups and group activity independently", async () => {
    mocks.links.mockResolvedValue([link("direct", true, "raw-token")]);
    mocks.groups.mockResolvedValue([group("single"), group("multi", { classes: [member(), member("class-2")], links: [link("old", false), link("current")] }), group("stopped", { isActive: false })]);
    const result = (await getClassApplicationLinks("class-1"))!;
    expect(result.scopes.map((scope) => scope.label)).toEqual(["이 클래스 전용", "이 클래스 전용", "여러 클래스 통합", "이 클래스 전용"]);
    expect(result.scopes[0]?.links[0]?.rawPath).toBe("/apply/raw-token");
    expect(result.scopes[1]?.links[0]).toMatchObject({ isActive: true, rawPath: null });
    expect(result.scopes[1]?.readiness.issuance).toBe("ACTIVE");
    expect(result.scopes[2]?.links).toHaveLength(2);
    expect(result.scopes[3]).toMatchObject({ scopeActive: false, links: [{ isActive: true }], readiness: { issuance: "STOPPED" } });
    expect(JSON.stringify(mocks.links.mock.calls)).not.toContain("tokenHash");
    expect(JSON.stringify(mocks.groups.mock.calls)).not.toContain("tokenHash");
    expect(mocks.groups.mock.calls[0]?.[0].where.OR).toEqual([{ classes: { some: { classScheduleId: "class-1" } } }, { upgradedLegacyClassScheduleId: "class-1" }]);
  });
  it("keeps upgraded legacy provenance after membership removal and on another member class", async () => {
    mocks.links.mockResolvedValue([link("legacy", true, "old-address")]);
    mocks.groups.mockResolvedValue([group("upgrade", { upgradedLegacyClassScheduleId: "class-1", classes: [member("class-2")] }), group("other-upgrade", { upgradedLegacyClassScheduleId: "class-3" })]);
    const result = (await getClassApplicationLinks("class-1"))!;
    expect(result.scopes.map((scope) => scope.label)).toEqual(Array(3).fill("기존 주소를 전환한 링크"));
    expect(result.scopes[0]).toMatchObject({ currentClassMember: false, activeForCurrentClass: false, links: [{ rawPath: null }], readiness: { classIntake: "READY" } });
    expect(result.scopes[0]?.members.map((item) => item.id)).toEqual(["class-2"]);
    expect(result.scopes[1]?.currentClassMember).toBe(false);
    expect(result.scopes[2]?.upgraded).toBe(true);
  });
  it("does not count an active group link as active for an excluded original class", async () => {
    mocks.groups.mockResolvedValue([group("upgrade", { upgradedLegacyClassScheduleId: "class-1", classes: [member("class-2")] })]);
    const result = (await getClassApplicationLinks("class-1"))!;
    expect(result.scopes[0]).toMatchObject({ scopeActive: true, currentClassMember: false, activeForCurrentClass: false, links: [{ isActive: true }], readiness: { issuance: "ACTIVE", classIntake: "READY" } });
    expect(result.scopes.some((scope) => scope.activeForCurrentClass)).toBe(false);
  });
  it("counts an active group link as active when the current class is included", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    mocks.groups.mockResolvedValue([group("included")]);
    expect((await getClassApplicationLinks("class-1"))?.scopes[0]).toMatchObject({ scopeActive: true, currentClassMember: true, activeForCurrentClass: true, readiness: { publicAccessAllowed: false } });
  });
  it("retains excluded group links and upgraded legacy records in the history inventory", async () => {
    mocks.links.mockResolvedValue([link("legacy-active", true, "old-address"), link("legacy-old", false)]);
    mocks.groups.mockResolvedValue([group("upgrade", { upgradedLegacyClassScheduleId: "class-1", classes: [member("class-2")], links: [link("group-active"), link("group-old", false)] })]);
    const result = (await getClassApplicationLinks("class-1"))!;
    expect(result.scopes).toHaveLength(2);
    expect(result.scopes.map((scope) => scope.links.map((item) => item.id))).toEqual([["legacy-active", "legacy-old"], ["group-active", "group-old"]]);
    expect(result.scopes.every((scope) => !scope.currentClassMember && !scope.activeForCurrentClass)).toBe(true);
    expect(result.scopes.flatMap((scope) => scope.links).every((item) => item.rawPath === null)).toBe(true);
  });
  it.each(["CANCELLED", "STARTED", "PRICE_MISSING"])("preserves %s intake independently of excluded membership", async (state) => {
    const schedule = await mocks.classRead();
    mocks.classRead.mockResolvedValue({ ...schedule, ...(state === "CANCELLED" ? { status: "CANCELLED" } : state === "STARTED" ? { startsAt: NOW } : { applicationPrice: null }) });
    mocks.groups.mockResolvedValue([group("excluded", { upgradedLegacyClassScheduleId: "class-1", classes: [] })]);
    expect((await getClassApplicationLinks("class-1"))?.scopes[0]).toMatchObject({ scopeActive: true, currentClassMember: false, activeForCurrentClass: false, readiness: { issuance: "ACTIVE", classIntake: state } });
  });
  it("separates stopped scope from Preview restriction, with scoped settings diagnostics", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    mocks.groups.mockResolvedValue([group("preview", { isActive: false, syntheticSettings: settings })]);
    expect((await getClassApplicationLinks("class-1"))?.scopes[0]?.readiness).toMatchObject({ issuance: "STOPPED", publicAccessAllowed: false, guideReady: true, environment: "Preview" });
  });
  it("does not advertise a Production synthetic group as accessible", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    mocks.groups.mockResolvedValue([group("synthetic", { syntheticRunId: "test-run" })]);
    expect((await getClassApplicationLinks("class-1"))?.scopes[0]?.readiness).toMatchObject({ issuance: "ACTIVE", publicAccessAllowed: false, accessRestriction: "SYNTHETIC" });
  });
  it("retains stopped direct metadata without a reusable raw address", async () => {
    mocks.links.mockResolvedValue([link("stopped", false, "retired-address")]);
    expect((await getClassApplicationLinks("class-1"))?.scopes[0]).toMatchObject({ links: [{ rawPath: null }], readiness: { issuance: "STOPPED" } });
  });
  it.each(["CANCELLED", "STARTED"])("retains active scope inventory when the class is %s", async (state) => {
    const schedule = await mocks.classRead();
    mocks.classRead.mockResolvedValue({ ...schedule, ...(state === "CANCELLED" ? { status: "CANCELLED" } : { startsAt: NOW }) });
    mocks.groups.mockResolvedValue([group("existing")]);
    expect(await getClassApplicationLinks("class-1")).toMatchObject({ canIssue: false, scopes: [{ readiness: { issuance: "ACTIVE", classIntake: state } }] });
  });
  it.each(["MANAGER", "TEACHER"])("blocks %s before any sensitive DB call", async (role) => {
    mocks.admin.mockRejectedValue(new Error(`${role}_DENIED`));
    await expect(getClassApplicationLinks("class-1")).rejects.toThrow("DENIED");
    for (const read of [mocks.classRead, mocks.links, mocks.groups, mocks.settings]) expect(read).not.toHaveBeenCalled();
  });
  it("propagates read errors instead of reporting missing issuance", async () => {
    mocks.groups.mockRejectedValueOnce(new Error("read failed"));
    await expect(getClassApplicationLinks("class-1")).rejects.toThrow("read failed");
  });
});

it("retains no-link configuration/consent issues instead of hiding them behind empty inventory", async () => {
  vi.stubEnv("VERCEL_ENV", "production");
  mocks.settings.mockResolvedValue(null); mocks.consent.mockReturnValue(false);
  expect(await getClassApplicationLinks("class-1")).toMatchObject({ scopes: [], unissuedReadiness: { issuance: "NONE", guideReady: false, consentReady: false } });
});

describe("class-context composition options", () => {
  it("includes the current class when it lies beyond the future-class page", async () => {
    const current = await mocks.classRead();
    mocks.classes.mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({ ...current, id: `earlier-${index}` })));
    const options = await getLinkCompositionOptions("class-1");
    expect(options).toHaveLength(101);
    expect(options[0]).toMatchObject({ id: "class-1", eligible: true, applicationPrice: 10000 });
  });
  it("keeps a closed current class visible and ineligible instead of offering another class implicitly", async () => {
    mocks.classRead.mockResolvedValue({ ...(await mocks.classRead()), status: "CANCELLED" });
    expect(await getLinkCompositionOptions("class-1")).toMatchObject([{ id: "class-1", eligible: false }]);
  });
  it("avoids duplicating an already included current class", async () => {
    mocks.classes.mockResolvedValue([await mocks.classRead()]);
    expect(await getLinkCompositionOptions("class-1")).toHaveLength(1);
  });
  it("denies non-admin composition reads before loading classes", async () => {
    mocks.admin.mockRejectedValue(new Error("DENIED"));
    await expect(getLinkCompositionOptions("class-1")).rejects.toThrow("DENIED");
    expect(mocks.classes).not.toHaveBeenCalled(); expect(mocks.classRead).not.toHaveBeenCalled();
  });
});
