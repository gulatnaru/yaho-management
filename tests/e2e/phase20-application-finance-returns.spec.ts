import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { phase20SyntheticMarker } from "@/lib/e2e/phase20-cleanup";
import { createApplicationGroupCore, issueApplicationGroupLinkCore } from "@/server/reservation-applications/groups";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error("ADMIN_EMAIL/ADMIN_PASSWORD 환경변수가 필요합니다.");

type Fixture = { groupId: string; token: string; marker: string; prices: [number, number] };

function pastKstDateTimeLocal(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(Date.now() - 60_000));
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${field("year")}-${field("month")}-${field("day")}T${field("hour")}:${field("minute")}`;
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(ADMIN_EMAIL as string);
  await page.getByLabel("비밀번호").fill(ADMIN_PASSWORD as string);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Data is rooted at the wrapper-owned synthetic group; cleanupPhase20PreviewRun removes all
 * ledger, mapping, payment, return, child, schedule and program descendants after this run. */
async function createFixture(prisma: PrismaClient): Promise<Fixture> {
  const runId = process.env.YAHO_E2E_RUN_ID as string;
  const marker = phase20SyntheticMarker(runId);
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  if (!admin) throw new Error("Preview E2E requires its existing ADMIN fixture");
  const program = await prisma.program.create({ data: { name: marker, defaultPrice: 0 }, select: { id: true } });
  const start = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const prices: [number, number] = [10_000, 12_000];
  const schedules = await Promise.all(prices.map((applicationPrice, index) => prisma.classSchedule.create({
    data: { programId: program.id, startsAt: new Date(start.getTime() + index * 86_400_000), endsAt: new Date(start.getTime() + index * 86_400_000 + 60 * 60 * 1000), location: marker, capacity: 8, applicationPrice },
    select: { id: true },
  })));
  const group = await createApplicationGroupCore(prisma, {
    classScheduleIds: schedules.map((schedule) => schedule.id), actorUserId: admin.id, now: new Date(), syntheticRunId: runId,
    syntheticSettings: { bankName: "테스트은행", accountNumber: "000000", accountHolder: "테스트예금주", blogUrl: "https://example.test/blog", instagramUrl: "https://example.test/instagram", kakaoChannelUrl: "https://example.test/kakao" },
  });
  const link = await issueApplicationGroupLinkCore(prisma, { groupId: group.groupId, actorUserId: admin.id, now: new Date() });
  return { groupId: group.groupId, token: link.token, marker, prices };
}

async function submitPublicFlow(page: Page, fixture: Fixture) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/apply/group/" + fixture.token);
  await page.getByLabel("보호자 이름").fill(fixture.marker);
  await page.getByLabel("보호자 연락처").fill("010-1234-5678");
  await page.getByLabel("입금자명").fill(fixture.marker);
  const firstChild = page.getByRole("group", { name: "아이 1" });
  await firstChild.getByLabel("아이 이름").fill(fixture.marker + "_one");
  await firstChild.getByLabel("생년월일").fill("2020-01-01");
  await page.getByRole("button", { name: "아이 추가" }).click();
  const secondChild = page.getByRole("group", { name: "아이 2" });
  await secondChild.getByLabel("아이 이름").fill(fixture.marker + "_two");
  await secondChild.getByLabel("생년월일").fill("2021-01-01");
  await secondChild.getByLabel("아이 2 클래스").selectOption({ index: 1 });
  const consents = page.locator('input[type="checkbox"]');
  for (let index = 0; index < await consents.count(); index += 1) await consents.nth(index).check();
  await page.getByRole("button", { name: "신청하기" }).click();
  await expect(page.getByRole("heading", { name: "신청이 접수되었습니다" })).toBeVisible();
}

test.describe("Phase 20 finance and return browser flow", () => {
  test("C/D. public guide and notification lead to selected confirmation and partial actual returns without a Refund", async ({ page }) => {
    test.skip(process.env.PLAYWRIGHT_PREVIEW_E2E !== "1", "Preview wrapper lease is required before fixture writes");
    test.setTimeout(180_000);
    const prisma = new PrismaClient();
    try {
      const fixture = await createFixture(prisma);
      await submitPublicFlow(page, fixture);
      for (const value of [fixture.prices[0].toLocaleString("ko-KR") + "원", fixture.prices[1].toLocaleString("ko-KR") + "원", "22,000원", "테스트은행", "000000", fixture.marker]) await expect(page.getByText(value, { exact: true })).toBeVisible();
      for (const [name, expectedClipboard] of [["계좌번호 복사", "000000"], ["금액 복사", "22000"], ["입금자명 복사", fixture.marker]] as const) {
        await page.getByRole("button", { name }).click();
        await expect(page.getByRole("status")).toHaveText("복사했습니다.");
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expectedClipboard);
      }
      await page.getByRole("button", { name: "입금했어요" }).click();
      await expect(page.getByRole("status")).toContainText("입금 알림을 기록했습니다");
      const notifiedOnce = await prisma.reservationApplicationSubmission.findFirstOrThrow({ where: { groupId: fixture.groupId }, select: { depositNotifiedAt: true } });
      await page.getByRole("button", { name: "입금했어요" }).click();
      await expect(page.getByRole("status")).toContainText("입금 알림을 기록했습니다");

      const submission = await prisma.reservationApplicationSubmission.findFirstOrThrow({
        where: { groupId: fixture.groupId },
        select: { id: true, depositNotifiedAt: true, applications: { orderBy: { quotedAmount: "asc" }, select: { id: true } } },
      });
      expect(submission.depositNotifiedAt?.getTime()).toBe(notifiedOnce.depositNotifiedAt?.getTime());
      expect(submission.applications).toHaveLength(2);
      await loginAsAdmin(page);
      await page.goto("/reservation-applications/submissions/" + submission.id);
      await expect(page.getByText("보호자가 입금 알림을 보냈습니다.")).toBeVisible();
      await page.locator('input[name="amount"]').fill("30000");
      await page.locator('input[name="payerName"]').fill(fixture.marker);
      const actualDepositAt = pastKstDateTimeLocal();
      await page.locator('input[name="depositedAt"]').fill(actualDepositAt);
      await page.locator('input[name="idempotencyKey"]').fill(fixture.marker + "-deposit");
      await page.getByRole("button", { name: "실제 입금 기록" }).click();
      await expect(page.getByText("현재 가용 입금액 22,000원", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "실제 입금 기록" }).click();
      await expect(page.getByText("현재 가용 입금액 22,000원", { exact: true })).toBeVisible();
      expect(await prisma.applicationDeposit.count({ where: { submissionId: submission.id } })).toBe(1);

      // Revenue aggregates only PaymentItem/Payment facts. These owned counts prove that a
      // customer notification, actual bank deposit and return hold have no pre-confirmation revenue source.
      const [preConfirmationReservations, preConfirmationMappings, preConfirmationItems] = await Promise.all([
        prisma.reservation.count({ where: { classSchedule: { location: fixture.marker } } }),
        prisma.reservationApplicationPaymentMapping.count({ where: { application: { submissionId: submission.id } } }),
        prisma.paymentItem.count({ where: { reservation: { classSchedule: { location: fixture.marker } } } }),
      ]);
      expect([preConfirmationReservations, preConfirmationMappings, preConfirmationItems]).toEqual([0, 0, 0]);

      await page.goto("/reservation-applications/" + submission.applications[1]!.id);
      await page.getByLabel("반려 사유").fill("테스트 반려");
      await page.getByRole("button", { name: "신청 반려", exact: true }).click();
      await expect(page.getByText("반려", { exact: true })).toHaveCount(1);
      await page.goto("/reservation-applications/submissions/" + submission.id);
      const confirmationCheckbox = page.getByLabel("확정", { exact: true });
      await expect(confirmationCheckbox).toHaveCount(1);
      await expect(page.getByLabel(fixture.marker + "_one 확정 대상")).toHaveValue("NEW");
      await confirmationCheckbox.check();
      await page.getByRole("button", { name: "선택한 아이 일괄 확정" }).click();
      await expect(page.getByRole("status")).toHaveText("선택한 예약을 확정했습니다.");

      await page.goto("/reservation-applications/returns");
      const obligations = await prisma.returnObligation.findMany({ where: { submissionId: submission.id, resolvedAt: null }, select: { id: true, kind: true, amount: true } });
      const excess = obligations.find((obligation) => obligation.kind === "EXCESS");
      const rejected = obligations.find((obligation) => obligation.kind === "REJECTED");
      expect(excess?.amount).toBe(8_000);
      expect(rejected?.amount).toBe(12_000);
      for (const [obligation, amounts, partialRemaining] of [[excess, [3_000, 5_000], 5_000], [rejected, [5_000, 7_000], 7_000]] as const) {
        expect(obligation).toBeDefined();
        const card = page.getByTestId("return-obligation-" + obligation!.id);
        await expect(card).toBeVisible();
        for (let index = 0; index < amounts.length; index += 1) {
          const form = card.locator("form");
          const amount = amounts[index]!;
          await form.locator('input[name="amount"]').fill(String(amount));
          await form.locator('input[name="reason"]').fill("테스트 반환");
          await form.getByLabel("실제 반환일시 (KST)").fill(pastKstDateTimeLocal());
          await form.getByRole("button", { name: "반환 기록" }).click();
          if (index === 0) await expect(form.getByRole("status")).toHaveText("남은 반환 " + partialRemaining.toLocaleString("ko-KR") + "원");
        }
        await expect(card).toHaveCount(0);
      }
      await page.goto("/reservation-applications/submissions/" + submission.id);
      await expect(page.getByRole("heading", { name: "예약 확정 전 반환 내역" })).toBeVisible();
      await expect(page.getByText("완료 반환 8,000원", { exact: true })).toBeVisible();
      await expect(page.getByText("완료 반환 12,000원", { exact: true })).toBeVisible();

      const [payment, mappings, returns, refunds] = await Promise.all([
        prisma.payment.findFirst({ where: { items: { some: { reservation: { classSchedule: { location: fixture.marker } } } } }, select: { totalAmount: true, paidAt: true, items: { select: { amount: true, paidAmount: true, refundedAmount: true } } } }),
        prisma.reservationApplicationPaymentMapping.findMany({ where: { application: { submissionId: submission.id } }, select: { paymentItem: { select: { amount: true, paidAmount: true, refundedAmount: true } } } }),
        prisma.applicationReturn.findMany({ where: { returnObligation: { submissionId: submission.id } }, select: { amount: true, returnedAt: true, createdAt: true, reason: true, processedById: true } }),
        prisma.refund.count({ where: { paymentItem: { payment: { items: { some: { reservation: { classSchedule: { location: fixture.marker } } } } } } } }),
      ]);
      expect(payment?.totalAmount).toBe(fixture.prices[0]);
      expect(payment?.paidAt?.getTime()).toBeGreaterThan(new Date(`${actualDepositAt}:00+09:00`).getTime());
      expect(payment?.items).toEqual([{ amount: fixture.prices[0], paidAmount: fixture.prices[0], refundedAmount: 0 }]);
      expect(mappings).toEqual([{ paymentItem: { amount: fixture.prices[0], paidAmount: fixture.prices[0], refundedAmount: 0 } }]);
      expect(returns.reduce((sum, row) => sum + row.amount, 0)).toBe(20_000);
      expect(returns.every((record) => record.reason === "테스트 반환" && record.processedById !== null && record.createdAt.getTime() >= record.returnedAt.getTime())).toBe(true);
      expect(refunds).toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  });
});
