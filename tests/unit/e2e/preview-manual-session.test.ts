import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const authMock = vi.fn();
const userLookupMock = vi.fn();
const linkLookupMock = vi.fn();
const submissionLookupMock = vi.fn();
const depositUpdateMock = vi.fn();
const settingsLookupMock = vi.fn();
const leaseMock = vi.fn();
const headersMock = vi.fn();
const issueInviteMock = vi.fn();
const revokeInviteMock = vi.fn();
const companionInviteLookupMock = vi.fn();
const submitGroupMock = vi.fn();
const manualRunId = "manual-abcdefghijklmnopqrstuv";

vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => authMock(...args) }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    companionInvite: { findFirst: (...args: unknown[]) => companionInviteLookupMock(...args) },
    user: { findUnique: (...args: unknown[]) => userLookupMock(...args) },
    reservationApplicationLink: { findFirst: (...args: unknown[]) => linkLookupMock(...args) },
    reservationApplicationSubmission: {
      findFirst: (...args: unknown[]) => submissionLookupMock(...args),
      updateMany: (...args: unknown[]) => depositUpdateMock(...args),
    },
    reservationApplicationSettings: { findUnique: (...args: unknown[]) => settingsLookupMock(...args) },
  },
}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => headersMock(...args),
  cookies: async () => ({ get: () => ({ value: "synthetic-completion-token" }) }),
}));
vi.mock("@/lib/e2e/phase20-lease", () => ({
  PHASE20_PREVIEW_HEADER: "x-yaho-phase20-preview-run",
  parseAndVerifySignedPreviewRun: vi.fn().mockReturnValue(null),
  hasActivePhase20PreviewLease: (...args: unknown[]) => leaseMock(...args),
}));
vi.mock("@/server/reservation-applications/groups", () => ({
  submitApplicationGroupCore: (...args: unknown[]) => submitGroupMock(...args),
  issueCompanionInviteCore: (...args: unknown[]) => issueInviteMock(...args),
  revokeCompanionInviteCore: (...args: unknown[]) => revokeInviteMock(...args),
}));
vi.mock("@/app/(public)/apply/group/[token]/group-application-form", () => ({
  GroupApplicationForm: () => React.createElement("form", { "data-testid": "group-application-form" }),
}));

const authorization = await import("@/lib/auth/authorization");
const { hasOperatorPreviewTestSession, resolvePreviewApplyAccess } = await import("@/lib/e2e/preview-manual-session");
const { default: GroupApplicationPage } = await import("@/app/(public)/apply/group/[token]/page");
const { default: CompletionPage } = await import("@/app/(public)/apply/complete/page");
const { submitApplicationGroupWithCompanion } = await import("@/app/(public)/apply/group/[token]/actions");
const { notifyApplicationDeposit, createCompanionInvitation, revokeCompanionInvitation } = await import("@/app/(public)/apply/complete/completion-actions");

function userRow(role: "ADMIN" | "MANAGER" | "TEACHER" = "ADMIN") {
  return {
    id: "operator-1", name: "Synthetic operator", email: "operator@yaho.test", role,
    isActive: true, authVersion: 3, mustChangePassword: false,
    teacherId: role === "TEACHER" ? "teacher-1" : null,
    teacher: role === "TEACHER" ? { id: "teacher-1", isActive: true } : null,
  };
}

describe("Preview manual session access", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    authMock.mockReset().mockResolvedValue({ user: { id: "operator-1", authVersion: 3 } });
    userLookupMock.mockReset().mockResolvedValue(userRow());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(["production", "development", undefined])("skips session lookup outside Preview (%s)", async (environment) => {
    vi.stubEnv("VERCEL_ENV", environment);
    await expect(resolvePreviewApplyAccess(false, manualRunId)).resolves.toEqual({ allowed: true, operatorSession: false });
    await expect(hasOperatorPreviewTestSession()).resolves.toBe(false);
    expect(authMock).not.toHaveBeenCalled();
    expect(userLookupMock).not.toHaveBeenCalled();
  });

  it("keeps lease access banner-free without consulting the operator session", async () => {
    authMock.mockRejectedValue(new Error("session lookup must not run"));
    await expect(resolvePreviewApplyAccess(true, null)).resolves.toEqual({ allowed: true, operatorSession: false });
    expect(authMock).not.toHaveBeenCalled();
    expect(userLookupMock).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "MANAGER"] as const)("allows a live %s session and requests a banner", async (role) => {
    userLookupMock.mockResolvedValue(userRow(role));
    await expect(resolvePreviewApplyAccess(false, manualRunId)).resolves.toEqual({ allowed: true, operatorSession: true });
    expect(userLookupMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "operator-1" } }));
  });

  it.each(["preview-abcdefghijklmnopqrstuv", null, "manual-too-short", "manual-abcdefghijklmnopqrstuvw"])("denies an operator for a non-manual run ID (%s) before session lookup", async (runId) => {
    await expect(resolvePreviewApplyAccess(false, runId)).resolves.toEqual({ allowed: false, operatorSession: false });
    expect(authMock).not.toHaveBeenCalled();
    expect(userLookupMock).not.toHaveBeenCalled();
  });

  it("rejects a live TEACHER session", async () => {
    userLookupMock.mockResolvedValue(userRow("TEACHER"));
    await expect(resolvePreviewApplyAccess(false, manualRunId)).resolves.toEqual({ allowed: false, operatorSession: false });
  });

  it("rejects anonymous requests before a database lookup", async () => {
    authMock.mockResolvedValue(null);
    await expect(resolvePreviewApplyAccess(false, manualRunId)).resolves.toEqual({ allowed: false, operatorSession: false });
    expect(userLookupMock).not.toHaveBeenCalled();
  });

  it.each([
    { isActive: false },
    { authVersion: 4 },
    { mustChangePassword: true },
  ])("rejects invalid live account state %j", async (overrides) => {
    userLookupMock.mockResolvedValue({ ...userRow(), ...overrides });
    await expect(resolvePreviewApplyAccess(false, manualRunId)).resolves.toEqual({ allowed: false, operatorSession: false });
  });

  it("rejects a deleted account", async () => {
    userLookupMock.mockResolvedValue(null);
    await expect(authorization.getOptionalOperationalPrincipal()).resolves.toBeNull();
  });

  it("fails closed on authentication errors", async () => {
    authMock.mockRejectedValue(new Error("auth unavailable"));
    await expect(resolvePreviewApplyAccess(false, manualRunId)).resolves.toEqual({ allowed: false, operatorSession: false });
  });

  it("fails closed on live principal database errors", async () => {
    userLookupMock.mockRejectedValue(new Error("lookup unavailable"));
    await expect(authorization.getOptionalOperationalPrincipal()).resolves.toBeNull();
    await expect(resolvePreviewApplyAccess(false, manualRunId)).resolves.toEqual({ allowed: false, operatorSession: false });
  });

  it("fails closed even if the optional principal helper unexpectedly throws", async () => {
    vi.spyOn(authorization, "getOptionalOperationalPrincipal").mockRejectedValue(new Error("unexpected"));
    await expect(resolvePreviewApplyAccess(false, manualRunId)).resolves.toEqual({ allowed: false, operatorSession: false });
  });
});

describe("public application route gate regressions", () => {
  const settings = {
    bankName: "Synthetic bank", accountNumber: "000-000", accountHolder: "Synthetic holder",
    blogUrl: "https://blog.example.test", instagramUrl: "https://instagram.example.test", kakaoChannelUrl: "https://channel.example.test",
  };
  const submission = (syntheticRunId: string | null = manualRunId) => ({
    id: "submission-1", declaredPayerName: "Synthetic payer",
    group: { syntheticRunId, syntheticSettings: settings },
    applications: [{ id: "application-1", childName: "Synthetic child", status: "SUBMITTED", quotedAmount: 10000, classSchedule: { endsAt: new Date("2099-01-01T02:00:00Z") } }],
  });

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubEnv("VERCEL_ENV", "preview");
    authMock.mockReset().mockResolvedValue({ user: { id: "operator-1", authVersion: 3 } });
    userLookupMock.mockReset().mockResolvedValue(userRow());
    leaseMock.mockReset().mockResolvedValue(false);
    headersMock.mockReset().mockResolvedValue(new Headers());
    settingsLookupMock.mockReset().mockResolvedValue(settings);
    linkLookupMock.mockReset().mockResolvedValue({ group: {
      syntheticRunId: manualRunId, syntheticSettings: settings,
      classes: [{ classSchedule: { id: "class-1", status: "SCHEDULED", startsAt: new Date("2099-01-01T01:00:00Z"), endsAt: new Date("2099-01-01T02:00:00Z"), location: "Synthetic location", program: { name: "Synthetic program" } } }],
    } });
    submissionLookupMock.mockReset().mockResolvedValue(submission());
    depositUpdateMock.mockReset().mockResolvedValue({ count: 1 });
    issueInviteMock.mockReset().mockResolvedValue({ token: "synthetic-invite" });
    revokeInviteMock.mockReset().mockResolvedValue(true);
    companionInviteLookupMock.mockReset().mockResolvedValue({ group: { syntheticRunId: manualRunId, syntheticSettings: settings } });
    submitGroupMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function renderPages() {
    return [
      renderToStaticMarkup(await GroupApplicationPage({ params: Promise.resolve({ token: "synthetic-group-token" }) })),
      renderToStaticMarkup(await CompletionPage()),
    ];
  }

  it("never calls the lease or session lookup on Production pages", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    submissionLookupMock.mockResolvedValue(submission(null));
    const pages = await renderPages();
    expect(pages[0]).toContain("group-application-form");
    expect(pages[1]).toContain("Synthetic bank");
    for (const html of pages) expect(html).not.toContain("preview-test-session-banner");
    expect(headersMock).not.toHaveBeenCalled();
    expect(leaseMock).not.toHaveBeenCalled();
    expect(authMock).not.toHaveBeenCalled();
    expect(linkLookupMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ group: { is: { isActive: true, syntheticRunId: null } } }),
    }));
  });

  it("keeps leased page renders banner-free and skips the session lookup", async () => {
    leaseMock.mockResolvedValue(true);
    const pages = await renderPages();
    expect(pages[0]).toContain("group-application-form");
    expect(pages[1]).toContain("Synthetic bank");
    for (const html of pages) expect(html).not.toContain("preview-test-session-banner");
    expect(authMock).not.toHaveBeenCalled();
  });

  it("renders the test banner and normal application content for an operator", async () => {
    const pages = await renderPages();
    expect(pages[0]).toContain("group-application-form");
    expect(pages[1]).toContain("Synthetic bank");
    for (const html of pages) expect(html).toContain('data-testid="preview-test-session-banner"');
  });

  it("keeps anonymous Preview visits closed without exposing transfer settings", async () => {
    authMock.mockResolvedValue(null);
    const pages = await renderPages();
    expect(pages[0]).toContain("현재 신청을 받지 않는 링크입니다.");
    expect(pages[0]).not.toContain("group-application-form");
    for (const html of pages) {
      expect(html).not.toContain("Synthetic bank");
      expect(html).not.toContain("preview-test-session-banner");
    }
  });

  it("allows an operator deposit notification while keeping invitation issuance and revocation lease-only", async () => {
    await expect(notifyApplicationDeposit()).resolves.toEqual({ notified: true });
    expect(depositUpdateMock).toHaveBeenCalledOnce();
    await expect(createCompanionInvitation()).resolves.toEqual({ error: "동행 초대장을 만들 수 없습니다." });
    await expect(revokeCompanionInvitation("/apply/companion/synthetic-invite")).resolves.toEqual({ revoked: false });
    expect(issueInviteMock).not.toHaveBeenCalled();
    expect(revokeInviteMock).not.toHaveBeenCalled();
  });

  it.each(["preview-abcdefghijklmnopqrstuv", null, "manual-too-short"])("denies operator page access and deposit notifications for non-manual groups (%s)", async (runId) => {
    linkLookupMock.mockResolvedValue({ group: {
      syntheticRunId: runId, syntheticSettings: settings,
      classes: [{ classSchedule: { id: "class-1", status: "SCHEDULED", startsAt: new Date("2099-01-01T01:00:00Z"), endsAt: new Date("2099-01-01T02:00:00Z"), location: "Synthetic location", program: { name: "Synthetic program" } } }],
    } });
    submissionLookupMock.mockResolvedValue(submission(runId));
    const pages = await renderPages();
    expect(pages[0]).not.toContain("group-application-form");
    for (const html of pages) {
      expect(html).not.toContain("Synthetic bank");
      expect(html).not.toContain("preview-test-session-banner");
    }
    await expect(notifyApplicationDeposit()).resolves.toEqual({ notified: false });
    expect(depositUpdateMock).not.toHaveBeenCalled();
    expect(authMock).not.toHaveBeenCalled();
  });

  it("keeps a manual group's companion submission lease-only for a live MANAGER", async () => {
    userLookupMock.mockResolvedValue(userRow("MANAGER"));
    const formData = new FormData();
    formData.set("payload", JSON.stringify({
      guardianName: "Synthetic guardian", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER", declaredPayerName: "Synthetic payer",
      children: [{
        classScheduleId: "class-1", childName: "Synthetic child", childBirthDate: "2020-01-01", childGender: "UNSPECIFIED",
        programTerms: true, privacyConsent: true, legalGuardianConfirmation: true, refundTerms: true,
      }],
    }));

    await expect(submitApplicationGroupWithCompanion(undefined, "invite-token", {}, formData)).resolves.toEqual({ error: "현재 신청을 받을 수 없습니다." });
    expect(companionInviteLookupMock).toHaveBeenCalledOnce();
    expect(userLookupMock).toHaveBeenCalledOnce();
    expect(submitGroupMock).not.toHaveBeenCalled();
  });

  it("rejects an empty group token's companion submission without a lease for a live MANAGER", async () => {
    userLookupMock.mockResolvedValue(userRow("MANAGER"));
    const formData = new FormData();
    formData.set("payload", JSON.stringify({
      guardianName: "Synthetic guardian", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER", declaredPayerName: "Synthetic payer",
      children: [{
        classScheduleId: "class-1", childName: "Synthetic child", childBirthDate: "2020-01-01", childGender: "UNSPECIFIED",
        programTerms: true, privacyConsent: true, legalGuardianConfirmation: true, refundTerms: true,
      }],
    }));

    await expect(submitApplicationGroupWithCompanion("", "invite-token", {}, formData)).resolves.toEqual({ error: "현재 신청을 받을 수 없습니다." });
    expect(companionInviteLookupMock).toHaveBeenCalledOnce();
    expect(linkLookupMock).not.toHaveBeenCalled();
    expect(leaseMock).toHaveBeenCalledOnce();
    expect(leaseMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ syntheticRunId: manualRunId }));
    expect(authMock).toHaveBeenCalledOnce();
    expect(userLookupMock).toHaveBeenCalledOnce();
    expect(submitGroupMock).not.toHaveBeenCalled();
  });

  it("preserves leased completion actions without consulting operator auth", async () => {
    leaseMock.mockResolvedValue(true);
    await expect(notifyApplicationDeposit()).resolves.toEqual({ notified: true });
    await expect(createCompanionInvitation()).resolves.toEqual({ url: "/apply/companion/synthetic-invite" });
    await expect(revokeCompanionInvitation("/apply/companion/synthetic-invite")).resolves.toEqual({ revoked: true });
    expect(authMock).not.toHaveBeenCalled();
  });

  it("preserves Production synthetic rejection before any lease or operator lookup", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(notifyApplicationDeposit()).resolves.toEqual({ notified: false });
    await expect(createCompanionInvitation()).resolves.toEqual({ error: "동행 초대장을 만들 수 없습니다." });
    await expect(revokeCompanionInvitation("/apply/companion/synthetic-invite")).resolves.toEqual({ revoked: false });
    expect(depositUpdateMock).not.toHaveBeenCalled();
    expect(issueInviteMock).not.toHaveBeenCalled();
    expect(revokeInviteMock).not.toHaveBeenCalled();
    expect(leaseMock).not.toHaveBeenCalled();
    expect(authMock).not.toHaveBeenCalled();
  });
});
