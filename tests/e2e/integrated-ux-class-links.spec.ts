import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";

// Read-only admission: operators supply existing synthetic fixtures and authenticated
// storage states. This Phase never creates fixtures, signs in, rotates tokens or cleans DB rows.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_E2E_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const fixtureSchema = z.object({
  noLink: z.string().min(1), hash: z.string().min(1), legacy: z.string().min(1),
  groups: z.string().min(1), stopped: z.string().min(1), cancelled: z.string().min(1), past: z.string().min(1),
  teacherAssigned: z.string().min(1),
});
const fixtures = process.env.UX_READ_ONLY_CLASS_FIXTURES ? fixtureSchema.parse(JSON.parse(process.env.UX_READ_ONLY_CLASS_FIXTURES)) : null;
const states = { ADMIN: process.env.UX_ADMIN_STORAGE_STATE, MANAGER: process.env.UX_MANAGER_STORAGE_STATE, TEACHER: process.env.UX_TEACHER_STORAGE_STATE };
const db = new PrismaClient();
test.afterAll(async () => { await db.$disconnect(); });

async function fingerprint() {
  const facts = await Promise.all([
    db.reservationApplicationLink.findMany({ orderBy: { id: "asc" }, select: { id: true, token: true, tokenHash: true, isActive: true, issuedAt: true } }),
    ...[db.reservationApplicationGroup, db.reservationApplicationGroupClass, db.reservationApplicationSubmission, db.reservationApplication, db.applicationDeposit, db.applicationReturn, db.returnObligation, db.child, db.reservation, db.payment, db.paymentItem, db.refund].map((model) => (model.count as () => Promise<number>)()),
  ]);
  // Assertions/artifacts never print raw URLs or tokens.
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}

test.describe("Phase 1 existing synthetic class inventory (read only)", () => {
  test.skip(!fixtures || !states.ADMIN, "Pending: provide UX_READ_ONLY_CLASS_FIXTURES and UX_ADMIN_STORAGE_STATE on dedicated local PostgreSQL. No fixtures are created.");
  test.use({ storageState: states.ADMIN });

  test("hash reload retains metadata; inventory includes multiple groups and closed class navigation", async ({ page }) => {
    const before = await fingerprint();
    await page.goto(`/classes/${fixtures!.hash}`);
    const card = page.getByTestId("application-link-card");
    await expect(card).toContainText("링크 활성");
    await expect(card).not.toContainText("미발급");
    await expect(card.getByRole("button", { name: "링크 복사" })).toHaveCount(0);
    await expect(card.getByRole("link", { name: "신청 화면 확인" })).toHaveCount(0);
    await page.reload();
    await expect(card).toContainText("주소는 발급할 때만 확인할 수 있습니다");
    const classUrl = page.url();
    await card.getByText("고급 설정 펼치기", { exact: true }).click();
    await expect(card.getByTestId("link-scope-list")).toBeVisible();
    expect(page.url()).toBe(classUrl);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto(`/classes/${fixtures!.groups}`);
    await page.getByText("고급 설정 펼치기", { exact: true }).click();
    const scopeCount = await page.getByTestId("link-scope-list").locator("section").count();
    expect(scopeCount).toBeGreaterThanOrEqual(2);
    for (const kind of ["cancelled", "past"] as const) {
      await page.goto(`/classes/${fixtures![kind]}`);
      await expect(card).toContainText("클래스 상태로 신규 접수 불가");
      await expect(card.getByRole("link", { name: "신청 목록 보기 · 전체 클래스" })).toBeVisible();
      await expect(card.getByRole("link", { name: "신청 목록 보기 · 전체 클래스" })).toHaveAttribute("href", "/reservation-applications");
      await expect(card.getByRole("button", { name: "링크 발급", exact: true })).toHaveCount(0);
    }
    await page.goto(`/classes/${fixtures!.stopped}`);
    await expect(card).toContainText("접수 중지");
    await expect(card.getByRole("button", { name: "링크 복사", exact: true })).toHaveCount(0);
    await page.goto(`/classes/${fixtures!.noLink}`);
    await expect(card).toContainText("미발급");
    await expect(card.getByRole("button", { name: "링크 발급", exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name: "신청 화면 확인" })).toHaveCount(0);
    expect(await fingerprint()).toBe(before);
  });

  test("copy denial keeps manual address; new tab/copy neither write rows nor rotate tokens", async ({ page, context, browserName }) => {
    const before = await fingerprint();
    await page.goto(`/classes/${fixtures!.legacy}`);
    const card = page.getByTestId("application-link-card");
    const address = card.getByRole("textbox", { name: "신청 링크 주소" });
    await expect(address).not.toHaveValue("");
    const raw = await address.inputValue();
    expect(new URL(raw).origin).toBe(new URL(page.url()).origin);
    await expect(card).toContainText("이 클래스 전용");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new DOMException("Denied", "NotAllowedError"); } } }));
    await card.getByRole("button", { name: "링크 복사", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText("주소를 길게 눌러 복사");
    expect((await address.inputValue()) === raw).toBe(true);
    await address.focus();
    expect(await address.evaluate((node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart === node.value.length)).toBe(true);
    if (browserName === "chromium") {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.reload();
      await card.getByRole("button", { name: "링크 복사", exact: true }).click();
      await expect(card.getByRole("status")).toContainText("신청 링크를 복사했습니다");
      expect((await page.evaluate(() => navigator.clipboard.readText())) === raw).toBe(true);
    }
    await page.evaluate(() => Object.defineProperty(navigator, "share", { configurable: true, value: undefined }));
    await card.getByRole("button", { name: "공유하기", exact: true }).click();
    await expect(card.getByRole("status")).toContainText("공유 기능을 사용할 수 없습니다");
    await page.evaluate(() => Object.defineProperty(navigator, "share", { configurable: true, value: async () => { throw new DOMException("Cancelled", "AbortError"); } }));
    await card.getByRole("button", { name: "공유하기", exact: true }).click();
    await expect(card.getByRole("alert")).toHaveCount(0);
    expect((await address.inputValue()) === raw).toBe(true);
    const popupPromise = page.waitForEvent("popup");
    await card.getByRole("link", { name: "신청 화면 확인" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    expect(new URL(popup.url()).origin).toBe(new URL(page.url()).origin);
    expect(new URL(popup.url()).search).toBe("");
    await popup.close();
    expect(await fingerprint()).toBe(before);
  });
});

for (const role of ["MANAGER", "TEACHER"] as const) {
  test.describe(`${role} sensitive inventory denial`, () => {
    test.skip(!fixtures || !states[role], `Pending: existing ${role} local authenticated storage state and fixtures required.`);
    test.use({ storageState: states[role] });
    test("class HTML/RSC contains no application card, token, scope management URL or price", async ({ page }) => {
      const id = role === "TEACHER" ? fixtures!.teacherAssigned : fixtures!.hash;
      const sensitive = await db.reservationApplicationLink.findMany({ select: { token: true, tokenHash: true } });
      const classPrice = await db.classSchedule.findUniqueOrThrow({ where: { id }, select: { applicationPrice: true } });
      const response = await page.goto(`/classes/${id}`);
      const html = await response!.text();
      await expect(page.getByTestId("application-link-card")).toHaveCount(0);
      expect(html.includes("이 클래스 신청 링크")).toBe(false);
      expect(html.includes("/reservation-applications/groups/")).toBe(false);
      if (classPrice.applicationPrice !== null) expect(html.includes(`applicationPrice\\\":${classPrice.applicationPrice}`)).toBe(false);
      for (const value of sensitive.flatMap((row) => [row.token, row.tokenHash]).filter((value): value is string => Boolean(value))) expect(html.includes(value)).toBe(false);
      await page.goto("/reservation-applications/groups");
      await expect(page.getByRole("heading", { name: "신청 그룹" })).toHaveCount(0);
    });
  });
}
