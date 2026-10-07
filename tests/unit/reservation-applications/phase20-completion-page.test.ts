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
