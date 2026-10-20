import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationCompletionView } from "@/lib/reservation-applications/completion";

const mocked = vi.hoisted(() => ({
  cookies: vi.fn(),
  headers: vi.fn(),
  noStore: vi.fn(),
  loadCompletion: vi.fn(),
  settings: vi.fn(),
  previewLease: vi.fn(),
  readLegacyConfig: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocked.cookies, headers: mocked.headers }));
vi.mock("next/cache", () => ({ unstable_noStore: mocked.noStore }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/reservation-applications/completion", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/reservation-applications/completion")>(),
  loadApplicationCompletionView: mocked.loadCompletion,
}));
vi.mock("@/server/reservation-applications/settings", () => ({ getReservationApplicationSettings: mocked.settings }));
vi.mock("@/lib/e2e/phase20-lease", () => ({
  PHASE20_PREVIEW_HEADER: "x-yaho-phase20-preview-run",
  hasActivePhase20PreviewLease: mocked.previewLease,
  parseAndVerifySignedPreviewRun: vi.fn(),
}));
vi.mock("@/lib/e2e/preview-manual-session", () => ({
  resolvePreviewApplyAccess: (hasLease: boolean) => Promise.resolve({ allowed: hasLease, operatorSession: false }),
}));
vi.mock("@/lib/reservation-applications/config", () => ({ readPublicApplicationConfig: mocked.readLegacyConfig }));
vi.mock("@/components/ui/button", () => ({ buttonVariants: () => "" }));
vi.mock("@/components/ui/card", () => {
  const Container = ({ children }: { children: React.ReactNode }) => children;
  return { Card: Container, CardContent: Container, CardHeader: Container, CardTitle: Container };
});
vi.mock("@/app/(public)/apply/complete/completion-guide", () => {
  return {
    CompletionGuide: ({ bankName, accountNumber, applications }: { bankName: string; accountNumber: string; applications: Array<{ quotedAmount: number }> }) => `completion-guide:${bankName}|${accountNumber}|${applications.map((application) => application.quotedAmount).join(",")}`,
  };
});

import ReservationApplicationCompletePage from "@/app/(public)/apply/complete/page";

const dbSettings = {
  bankName: "DB은행",
  accountNumber: "111-222",
  accountHolder: "DB예금주",
  blogUrl: "https://example.test/blog",
  instagramUrl: "https://example.test/instagram",
  kakaoChannelUrl: "https://example.test/kakao",
};

function completion(overrides: Partial<ApplicationCompletionView> = {}): ApplicationCompletionView {
  return {
    submissionId: "submission-1",
    declaredPayerName: "입금자",
    depositNotifiedAt: null,
    syntheticRunId: null,
    syntheticSettings: { ...dbSettings, bankName: "합성은행" },
    applications: [{ id: "application-1", childName: "아이", quotedAmount: 10_000 }],
    ...overrides,
  };
}

async function renderPage() {
  return renderToStaticMarkup(await ReservationApplicationCompletePage());
}

describe("Phase 20 completion page capability boundary", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
    mocked.cookies.mockResolvedValue({ get: () => ({ value: "completion-capability" }) });
    mocked.headers.mockResolvedValue({ get: () => null });
    mocked.loadCompletion.mockResolvedValue(completion());
    mocked.settings.mockResolvedValue(dbSettings);
    mocked.previewLease.mockResolvedValue(false);
    mocked.readLegacyConfig.mockReturnValue({ bankName: "레거시은행", bankAccountNumber: "333-444", bankAccountHolder: "레거시예금주", blogUrl: "https://example.test/blog", instagramUrl: "https://example.test/instagram", kakaoChannelUrl: "https://example.test/kakao" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("renders the DB-authoritative bank and quoted amount for an authorized Production completion", async () => {
    const html = await renderPage();
    expect(html).toContain("completion-guide:");
    expect(html).toContain("DB은행|111-222|10000");
    expect(html).not.toContain("합성은행");
    expect(html).toContain("신청이 접수되었습니다");
    expect(html).toContain("아직 예약이 확정된 것은 아닙니다. 입금과 운영자 확인 후 예약이 확정됩니다.");
    expect(mocked.noStore).toHaveBeenCalledTimes(1);
    expect(mocked.loadCompletion).toHaveBeenCalledWith("completion-capability");
  });

  it.each(["missing", "invalid", "expired"])("preserves generic bank/channel navigation without own data for a %s capability", async (kind) => {
    mocked.cookies.mockResolvedValue({ get: () => kind === "missing" ? undefined : { value: kind } });
    mocked.loadCompletion.mockResolvedValue(null);
    const html = await renderPage();
    expect(mocked.loadCompletion).toHaveBeenCalledWith(kind === "missing" ? undefined : kind);
    for (const value of ["DB은행", "111-222", "DB예금주", "YAHO 블로그", "YAHO Instagram", "YAHO 카카오톡 채널"]) expect(html).toContain(value);
    for (const url of [dbSettings.blogUrl, dbSettings.instagramUrl, dbSettings.kakaoChannelUrl]) expect(html).toContain(`href="${url}"`);
    expect(html.match(/target="_blank"/g)).toHaveLength(3);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(3);
    for (const value of ["completion-guide:", "10000", "입금자명", "입금했어요", "친구 보호자 초대"]) expect(html).not.toContain(value);
  });

  it("preserves legacy env guidance only when the DB singleton is absent", async () => {
    mocked.loadCompletion.mockResolvedValue(null); mocked.settings.mockResolvedValue(null);
    const html = await renderPage();
    expect(html).toContain("레거시은행"); expect(html).toContain("333-444"); expect(html).toContain("레거시예금주");
    expect(mocked.readLegacyConfig).toHaveBeenCalledTimes(1);
  });

  it("never substitutes another completion or generic screen when the capability read fails", async () => {
    mocked.loadCompletion.mockRejectedValue(new Error("synthetic read failure"));
    await expect(ReservationApplicationCompletePage()).rejects.toThrow("synthetic read failure");
    expect(mocked.loadCompletion).toHaveBeenCalledTimes(1); expect(mocked.readLegacyConfig).not.toHaveBeenCalled();
  });

  it("fails closed when a valid Phase 20 completion has no DB settings", async () => {
    mocked.settings.mockResolvedValue(null);
    const html = await renderPage();
    expect(html).not.toContain("completion-guide:");
    expect(html).not.toContain("레거시은행");
  });

  it("does not render a synthetic completion guide in Production", async () => {
    mocked.loadCompletion.mockResolvedValue(completion({ syntheticRunId: "preview-owned-run" }));
    const html = await renderPage();
    expect(html).not.toContain("completion-guide:");
    expect(html).not.toContain("DB은행");
  });

  it("does not fall back to bank details for an unleased Preview completion", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    mocked.loadCompletion.mockResolvedValue(completion({ syntheticRunId: "preview-owned-run" }));
    const html = await renderPage();
    expect(html).not.toContain("completion-guide:");
    expect(html).not.toContain("DB은행");
    expect(html).not.toContain("합성은행");
  });

  it("does not render active guide controls for a terminal completion with no quoted applications", async () => {
    mocked.loadCompletion.mockResolvedValue(completion({ applications: [] }));
    const html = await renderPage();
    expect(html).not.toContain("completion-guide:");
    expect(html).not.toContain("DB은행");
  });
});
