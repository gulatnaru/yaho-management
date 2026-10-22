import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";
import { observeActions, saveClassApplicationPrice, traceUx } from "./support/integrated-ux-sync";

// Local-only admission: operators supply synthetic fixtures and authenticated states.
// Phase 1 remains read-only; Phase 2 mutations are restricted to explicitly supplied run-owned classes.
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
      await expect(card.getByRole("button", { name: "신청 링크 발급", exact: true })).toHaveCount(0);
    }
    await page.goto(`/classes/${fixtures!.stopped}`);
    await expect(card).toContainText("접수 중지");
    await expect(card.getByRole("button", { name: "링크 복사", exact: true })).toHaveCount(0);
    await page.goto(`/classes/${fixtures!.noLink}`);
    await expect(card).toContainText("미발급");
    await expect(card.getByRole("button", { name: "신청 링크 발급", exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name: "신청 화면 확인" })).toHaveCount(0);
    expect(await fingerprint()).toBe(before);
  });

  test("copy denial keeps manual address; new tab/copy neither write rows nor rotate tokens", async ({ page, context, browserName }) => {
    const before = await fingerprint();
    await page.goto(`/classes/${fixtures!.legacy}`);
    const card = page.getByTestId("application-link-card");
    const address = card.getByRole("textbox", { name: "신청 링크 주소", exact: true });
    const started = Date.now();
    const [legacyClass, activePlaintextLinks, upgraded] = await Promise.all([
      db.classSchedule.findUniqueOrThrow({ where: { id: fixtures!.legacy }, select: { applicationPrice: true } }),
      db.reservationApplicationLink.count({ where: { classScheduleId: fixtures!.legacy, isActive: true, token: { not: null } } }),
      db.reservationApplicationGroup.count({ where: { upgradedLegacyClassScheduleId: fixtures!.legacy } }),
    ]);
    traceUx("class-link-fixture", started, { activePlaintextLinks, priceBefore: legacyClass.applicationPrice, addressCount: await address.count() });
    expect(activePlaintextLinks, "Read-only legacy fixture must contain an active stored plaintext link").toBe(1);
    expect(upgraded, "Read-only legacy fixture must not be an upgraded/hash-only scope").toBe(0);
    try { await expect(address).toHaveCount(1); await expect(address).not.toHaveValue(""); }
    finally { traceUx("class-link-fixture", started, { activePlaintextLinks, addressCount: await address.count() }); }
    const raw = await address.inputValue();
    expect(new URL(raw).origin).toBe(new URL(page.url()).origin);
    await expect(card).toContainText("이 클래스 전용");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new DOMException("Denied", "NotAllowedError"); } } }));
    await card.getByRole("button", { name: "링크 복사", exact: true }).click();
    await expect(card.getByRole("alert")).toHaveText("복사하지 못했습니다. 아래 주소를 길게 눌러 직접 복사해 주세요.");
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


const phase2Schema = z.object({ ownerPrefix: z.string().regex(/^ux2-[a-zA-Z0-9-]+$/), priceClass: z.string().min(1), additionalClass: z.string().min(1) });
const phase2 = process.env.UX_PHASE2_CLASS_FIXTURES ? phase2Schema.parse(JSON.parse(process.env.UX_PHASE2_CLASS_FIXTURES)) : null;
if (phase2 && [phase2.priceClass, phase2.additionalClass].some((id) => !id.startsWith(`${phase2.ownerPrefix}-`))) throw new Error("UX_PHASE2_RUN_OWNERSHIP_REQUIRED");

test.describe.serial("Phase 2 dedicated local synthetic issuance", () => {
  test.skip(!phase2 || !states.ADMIN, "BLOCKED: run-owned UX_PHASE2_CLASS_FIXTURES and local ADMIN state required; no Preview/Production substitute.");
  test.use({ storageState: states.ADMIN });
  test("inline price → atomic issue → safe copy/share/open → metadata-only revisit → scoped dialogs", async ({ page, context }) => {
    const id = phase2!.priceClass;
    // Fixtures must be dedicated to this browser project/run and start without links.
    const existing = await db.reservationApplicationGroup.count({ where: { classes: { some: { classScheduleId: id } } } });
    test.skip(existing > 0, "Provide fresh synthetic classes for each browser project; never rotate a fixture implicitly.");
    await page.goto(`/classes/${id}`);
    const card = page.getByTestId("application-link-card");
    const priceBefore = await db.classSchedule.findUniqueOrThrow({ where: { id }, select: { applicationPrice: true } });
    traceUx("class-price", Date.now(), { priceBefore: priceBefore.applicationPrice, requestedPrice: 25000 });
    try { await saveClassApplicationPrice(page, 25000); }
    finally {
      const stored = await db.classSchedule.findUniqueOrThrow({ where: { id }, select: { applicationPrice: true } });
      traceUx("class-price", Date.now(), { requestedPrice: 25000, storedPrice: stored.applicationPrice, displayedPrice: await card.getByText("참가비: 25,000원", { exact: true }).isVisible() });
    }
    expect((await db.classSchedule.findUniqueOrThrow({ where: { id }, select: { applicationPrice: true } })).applicationPrice).toBe(25000);
    const address = card.getByRole("textbox", { name: "신청 링크 주소", exact: true });
    const issue = observeActions(page, "class-link-fixture");
    try {
      await card.getByRole("button", { name: "신청 링크 발급", exact: true }).click(); issue.mark({ clicked: true });
      await expect(card.getByRole("status").filter({ hasText: "신청 링크를 발급했습니다." })).toHaveText("신청 링크를 발급했습니다.");
      await issue.settled();
      await expect(address).toHaveCount(1); await expect(address).not.toHaveValue("");
    } finally {
      issue.mark({ addressCount: await address.count(), receiptVisible: await card.getByText("신청 링크를 발급했습니다.", { exact: true }).isVisible() }); issue.stop();
      await (async () => {
        const issued = await db.reservationApplicationGroup.findMany({ where: { classes: { some: { classScheduleId: id } } }, select: { links: { select: { isActive: true } } } });
        traceUx("class-link-fixture", Date.now(), { issuedGroups: issued.length, activeLinks: issued.flatMap((row) => row.links).filter((row) => row.isActive).length });
      })().catch(() => traceUx("class-link-fixture", Date.now(), { diagnosticReadFailed: true }));
    }
    const raw = await address.inputValue();
    const group = await db.reservationApplicationGroup.findFirstOrThrow({ where: { classes: { some: { classScheduleId: id } } }, include: { links: true, classes: true } });
    expect(group.classes.length).toBe(1); expect(group.links.length).toBe(1);
    expect(group.links[0]?.token === null).toBe(true);
    const before = await fingerprint();
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new DOMException("Denied", "NotAllowedError"); } } }));
    await card.getByRole("button", { name: "링크 복사", exact: true }).click();
    await expect(card.getByRole("alert")).toHaveText("복사하지 못했습니다. 아래 주소를 길게 눌러 직접 복사해 주세요.");
    expect((await address.inputValue()) === raw).toBe(true);
    await address.focus();
    expect(await address.evaluate((node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart === node.value.length)).toBe(true);
    await page.evaluate(() => Object.defineProperty(navigator, "share", { configurable: true, value: undefined }));
    await card.getByRole("button", { name: "공유하기", exact: true }).click();
    await expect(card).toContainText("공유 기능을 사용할 수 없습니다");
    await page.evaluate(() => Object.defineProperty(navigator, "share", { configurable: true, value: async () => { throw new DOMException("Cancelled", "AbortError"); } }));
    await card.getByRole("button", { name: "공유하기", exact: true }).click();
    await expect(card).toContainText("공유를 취소했습니다");
    expect(await page.evaluate((value) => [...Object.values(localStorage), ...Object.values(sessionStorage)].some((entry) => entry.includes(value)), raw)).toBe(false);
    const popupPromise = page.waitForEvent("popup"); await card.getByRole("link", { name: "신청 화면 확인" }).click();
    const popup = await popupPromise; await popup.waitForLoadState("domcontentloaded");
    expect(new URL(popup.url()).origin === new URL(page.url()).origin).toBe(true); expect(new URL(popup.url()).search).toBe(""); await popup.close();
    expect(await fingerprint()).toBe(before);
    await page.reload(); await expect(card).toContainText("주소는 발급할 때만 확인할 수 있습니다"); await expect(address).toHaveCount(0);
    await card.getByText("고급 설정 펼치기", { exact: true }).click();
    await card.getByRole("button", { name: "링크 교체", exact: true }).click();
    const dialog = page.getByRole("dialog"); await expect(dialog).toContainText("기존 링크가 무효화됩니다"); await expect(dialog).toContainText("새 주소 재공유 필요");
    await dialog.getByRole("button", { name: "취소", exact: true }).click(); expect(await fingerprint()).toBe(before);
    await card.getByRole("button", { name: "신청 접수 중지", exact: true }).click();
    await expect(dialog).toContainText("신규 신청만 중지"); await dialog.getByRole("button", { name: "신청 접수 중지", exact: true }).click();
    await expect(card).toContainText("링크 비활성 · 접수 중지");
    await card.getByRole("button", { name: "접수 재개 및 새 링크 발급" }).click(); await expect(dialog).toContainText("이전 주소는 사용할 수 없습니다");
    await dialog.getByRole("button", { name: "새 링크로 접수 재개" }).click(); await expect(address).not.toHaveValue("");
    const current = await db.reservationApplicationLink.findUniqueOrThrow({ where: { id: group.links[0]!.id } }); expect(current.isActive).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // No guardian submission is generated by opening the form.
    expect(await db.reservationApplicationSubmission.count({ where: { groupId: group.id } })).toBe(0);
    expect(context.pages().length).toBeGreaterThanOrEqual(1);
  });
});
