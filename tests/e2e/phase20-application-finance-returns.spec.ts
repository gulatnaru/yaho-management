import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { phase20SyntheticMarker } from "@/lib/e2e/phase20-cleanup";
import { createApplicationGroupCore, issueApplicationGroupLinkCore } from "@/server/reservation-applications/groups";
import { submitAndExpectPublicCompletion } from "./support/public-completion";
import { confirmSelectedApplications, clickAndExpectPhase20Action, recordPhase20Stage, initialDepositProven, replayDepositProven, recordReplayDepositProof, recordInitialDepositProof } from "./support/phase20-action";
import { assertPreviewE2eRunnerProof } from "@/lib/e2e/preview-runner";
import { hasActivePhase20PreviewLease, parseAndVerifySignedPreviewRun } from "@/lib/e2e/phase20-lease";
import { observeDepositPending, readDepositPending, stopDepositPending } from "./support/phase20-deposit-state";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error("ADMIN_EMAIL/ADMIN_PASSWORD 환경변수가 필요합니다.");

type Fixture = { groupId: string; token: string; marker: string; prices: [number, number]; classIds: [string, string] };

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
  return { groupId: group.groupId, token: link.token, marker, prices, classIds: [schedules[0]!.id, schedules[1]!.id] };
}

async function submitPublicFlow(page: Page, fixture: Fixture) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/apply/group/" + fixture.token);
  await page.getByLabel("보호자 이름").fill(fixture.marker);
  await page.getByLabel("보호자 연락처").fill("010-1234-5678");
  await page.getByLabel("입금자명").fill(fixture.marker);
  const firstChild = page.getByRole("group", { name: "아이 1" });
  await firstChild.getByLabel("아이 1 클래스").selectOption(fixture.classIds[0]);
  await firstChild.getByLabel("아이 이름").fill(fixture.marker + "_one");
  await firstChild.getByLabel("생년월일").fill("2020-01-01");
  await page.getByRole("button", { name: "아이 추가" }).click();
  const secondChild = page.getByRole("group", { name: "아이 2" });
  await secondChild.getByLabel("아이 이름").fill(fixture.marker + "_two");
  await secondChild.getByLabel("생년월일").fill("2021-01-01");
  await secondChild.getByLabel("아이 2 클래스").selectOption(fixture.classIds[1]);
  const consents = page.locator('input[type="checkbox"]');
  for (let index = 0; index < await consents.count(); index += 1) await consents.nth(index).check();
  await submitAndExpectPublicCompletion(page);
}

test.describe("Phase 20 finance and return browser flow", () => {
  test("C/D. public guide and notification lead to selected confirmation and partial actual returns without a Refund", async ({ page }) => {
    test.skip(process.env.PLAYWRIGHT_PREVIEW_E2E !== "1", "Preview wrapper lease is required before fixture writes");
    // Measured return completion at 169s leaves final navigation and ledger queries.
    test.setTimeout(240_000);
    const testStartedAt = Date.now();
    const prisma = new PrismaClient();
    try {
      const fixture = await createFixture(prisma);
      await submitPublicFlow(page, fixture);
      recordPhase20Stage("INITIAL_COMPLETION", testStartedAt);
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
        select: { id: true, depositNotifiedAt: true, applications: { orderBy: { quotedAmount: "asc" }, select: { id: true, childName: true, classScheduleId: true, quotedAmount: true } } },
      });
      expect(submission.depositNotifiedAt?.getTime()).toBe(notifiedOnce.depositNotifiedAt?.getTime());
      expect(submission.applications).toHaveLength(2);
      expect(submission.applications[0]?.childName === fixture.marker + "_one" && submission.applications[0].classScheduleId === fixture.classIds[0] && submission.applications[0].quotedAmount === fixture.prices[0] && submission.applications[1]?.childName === fixture.marker + "_two" && submission.applications[1].classScheduleId === fixture.classIds[1] && submission.applications[1].quotedAmount === fixture.prices[1]).toBe(true);
      await loginAsAdmin(page);
      await page.goto("/reservation-applications/submissions/" + submission.id);
      await expect(page.getByText("보호자가 입금 알림을 보냈습니다.")).toBeVisible();
      await page.locator('input[name="amount"]').fill("30000");
      await page.locator('input[name="payerName"]').fill(fixture.marker);
      const actualDepositAt = pastKstDateTimeLocal();
      await page.locator('input[name="depositedAt"]').fill(actualDepositAt);
      const depositForm = page.locator("form").filter({ has: page.locator('input[name="depositedAt"]') });
      const originalKey = await depositForm.locator('input[name="idempotencyKey"]').inputValue();
      const available = depositForm.getByText("현재 가용 입금액 22,000원", { exact: true });
      const initialBalanceAbsent = await available.count() === 0;
      const beforeCount = await prisma.applicationDeposit.count({ where: { submissionId: submission.id } });
      if (!initialBalanceAbsent || beforeCount !== 0) throw new Error("P20_INITIAL_DEPOSIT_PRECONDITION_DENIED");
      await observeDepositPending(page, originalKey);
      try {
        await clickAndExpectPhase20Action(page, depositForm.getByRole("button", { name: "실제 입금 기록", exact: true }), available, Date.now, "DEPOSIT_INITIAL", async (action) => {
          assertPreviewE2eRunnerProof({ proofPath: process.env.PREVIEW_E2E_RUNNER_PROOF_PATH, proof: process.env.PREVIEW_E2E_RUNNER_PROOF });
          const environment = { ...process.env, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: process.env.PREVIEW_E2E_DEPLOYMENT_SHA };
          const runId = process.env.YAHO_E2E_RUN_ID ?? "";
          const signed = parseAndVerifySignedPreviewRun(process.env.PREVIEW_E2E_PHASE20_SIGNED_RUN ?? null, environment);
          if (!await hasActivePhase20PreviewLease(prisma, { signed, syntheticRunId: runId, now: new Date(), environment })) return false;
          const deposits = await prisma.applicationDeposit.findMany({ where: { submissionId: submission.id, submission: { groupId: fixture.groupId, group: { syntheticRunId: runId } } }, select: { amount: true, payerName: true, depositedAt: true, idempotencyKey: true } });
          const pending = await readDepositPending(page);
          const proof = { beforeCount, afterCount: deposits.length, nonceMatched: action.nonceMatched === true, ...pending, fieldsMatch: deposits.length === 1 && deposits[0]?.amount === 30_000 && deposits[0].payerName === fixture.marker && deposits[0].depositedAt.getTime() === new Date(`${actualDepositAt}:00+09:00`).getTime() && deposits[0].idempotencyKey === originalKey };
          recordInitialDepositProof(proof);
          return initialDepositProven({ initialBalanceAbsent, ...proof });
        }, originalKey);
      } finally { await stopDepositPending(page); }
      recordPhase20Stage("INITIAL_DEPOSIT", testStartedAt);
      const runId = process.env.YAHO_E2E_RUN_ID ?? "";
      const ownedDeposits = () => prisma.applicationDeposit.findMany({ where: { submissionId: submission.id, submission: { groupId: fixture.groupId, group: { syntheticRunId: runId } } }, select: { id: true, createdAt: true, amount: true, payerName: true, depositedAt: true, idempotencyKey: true } });
      const assertActiveRun = async () => {
        assertPreviewE2eRunnerProof({ proofPath: process.env.PREVIEW_E2E_RUNNER_PROOF_PATH, proof: process.env.PREVIEW_E2E_RUNNER_PROOF });
        const environment = { ...process.env, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: process.env.PREVIEW_E2E_DEPLOYMENT_SHA };
        const signed = parseAndVerifySignedPreviewRun(process.env.PREVIEW_E2E_PHASE20_SIGNED_RUN ?? null, environment);
        if (!await hasActivePhase20PreviewLease(prisma, { signed, syntheticRunId: runId, now: new Date(), environment })) throw new Error("P20_REPLAY_SCOPE_DENIED");
      };
      await assertActiveRun();
      const originalRows = await ownedDeposits();
      if (originalRows.length !== 1 || originalRows[0]?.idempotencyKey !== originalKey) throw new Error("P20_REPLAY_PRECONDITION_DENIED");
      const originalRow = originalRows[0];
      // A document reload resets useActionState: the next balance must come from
      // this replay, rather than the first action's retained receipt.
      await page.reload();
      await expect(depositForm.getByRole("button", { name: "실제 입금 기록", exact: true })).toBeVisible();
      const replayBalanceAbsent = await available.count() === 0;
      if (!replayBalanceAbsent) throw new Error("P20_REPLAY_STALE_RESULT");
      await expect(depositForm.getByRole("button", { name: "실제 입금 기록", exact: true })).toBeEnabled();
      await depositForm.locator('input[name="amount"]').fill("30000");
      await depositForm.locator('input[name="payerName"]').fill(fixture.marker);
      await depositForm.locator('input[name="depositedAt"]').fill(actualDepositAt);
      // The product rotates its nonce after success. Replay the same generated
      // nonce deliberately; hidden inputs cannot be edited with fill().
      await depositForm.locator('input[name="idempotencyKey"]').evaluate((element, value) => { (element as HTMLInputElement).value = value; }, originalKey);
      expect(await depositForm.locator('input[name="amount"]').inputValue() === "30000" && await depositForm.locator('input[name="payerName"]').inputValue() === fixture.marker && await depositForm.locator('input[name="depositedAt"]').inputValue() === actualDepositAt).toBe(true);
      await observeDepositPending(page, originalKey);
      try {
        await clickAndExpectPhase20Action(page, depositForm.getByRole("button", { name: "실제 입금 기록", exact: true }), available, Date.now, "DEPOSIT_REPLAY", async (action) => {
          await expect(depositForm.getByRole("button", { name: "실제 입금 기록", exact: true })).toBeEnabled();
          await assertActiveRun();
          const after = await ownedDeposits();
          const row = after[0];
          const pending = await readDepositPending(page);
          const proof = { initialBalanceAbsent: replayBalanceAbsent, freshResult: await available.count() === 1, beforeCount: originalRows.length, afterCount: after.length, nonceMatched: action.nonceMatched === true, ...pending, noError: await depositForm.locator("p.text-red-600").count() === 0, originalRowUnchanged: Boolean(row && row.id === originalRow.id && row.createdAt.getTime() === originalRow.createdAt.getTime() && row.idempotencyKey === originalKey && row.amount === originalRow.amount && row.payerName === originalRow.payerName && row.depositedAt.getTime() === originalRow.depositedAt.getTime()) };
          recordReplayDepositProof(proof);
          return replayDepositProven(proof);
        }, originalKey);
      } finally { await stopDepositPending(page); }
      recordPhase20Stage("DEPOSIT_REPLAY", testStartedAt);
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
      recordPhase20Stage("REJECTION", testStartedAt);
      await page.goto("/reservation-applications/submissions/" + submission.id);
      const confirmationCheckbox = page.getByLabel("확정", { exact: true });
      await expect(confirmationCheckbox).toHaveCount(1);
      await expect(page.getByLabel(fixture.marker + "_one 확정 대상")).toHaveValue("NEW");
      await confirmationCheckbox.check();
      await confirmSelectedApplications(page, { prisma, submissionId: submission.id, applicationIds: [submission.applications[0]!.id], childNames: [fixture.marker + "_one"] });
      recordPhase20Stage("INITIAL_CONFIRMATION", testStartedAt);

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
      recordPhase20Stage("PARTIAL_RETURNS", testStartedAt);
      const returnHistory = page.getByRole("heading", { name: "예약 확정 전 반환 내역", exact: true }).locator("..");
      for (const [kind, amount] of [["EXCESS", 8_000], ["REJECTED", 12_000]] as const) {
        const formatted = amount.toLocaleString("ko-KR");
        const card = returnHistory.locator(":scope > div").filter({ hasText: new RegExp(`^${kind} · 반환 필요 ${formatted}원 ·`) });
        await expect(card).toHaveCount(1);
        await expect(card).toBeVisible();
        await expect(card).toContainText(`완료 반환 ${formatted}원`);
        await expect(card).toContainText(new RegExp(`완료 반환 ${formatted}원 · 완료`));
      }

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
      recordPhase20Stage("FINAL_ASSERTIONS", testStartedAt);
    } finally {
      await prisma.$disconnect();
    }
  });
});
