import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";
import { assertFamilyLedger } from "./support/integrated-ux-invariants";
import {
  createRecoveryFamily, expectRecoveryAmounts, freshRecoveryContext, prepareRecoveryDeposit,
  prepareRecoveryReturn, recoveryDate, recoveryPayer, recoveryPath, recoverySnapshot,
  rejectRecoverySibling, saveRecoveryDeposit, type RecoveryFamily,
} from "./support/c11-recovery";
import { cleanupResidualFamily, holdBrowserRow } from "./support/c11-residual-locks";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("C11_RESIDUAL_BROWSER_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });

async function prepareDepositLookup(page: Page, key: string, amount: number) {
  const root = page.getByTestId("deposit-transaction-form");
  await root.getByLabel("다른 브라우저의 기존 거래 식별자", { exact: true }).fill(key);
  await root.getByRole("button", { name: "기존 거래 조회 준비", exact: true }).click();
  await root.getByLabel("실제 입금액", { exact: true }).fill(String(amount));
  await root.getByLabel("실제 은행 입금자명", { exact: true }).fill(recoveryPayer);
  await root.getByLabel("실제 입금일시 (KST)", { exact: true }).fill(recoveryDate);
  return root;
}
async function expectNoClaimOfOriginalSuccess(page: Page) {
  await expect(page.getByTestId("deposit-transaction-form").getByRole("status")).toHaveCount(0);
  await expect(page.getByTestId("workflow-status")).not.toContainText(/저장 결과와 최신 서버 원장을 확인했습니다|원래 요청.*성공|저장 기록 확인됨/);
  await expect(page.getByText(/원래 요청.*성공|원 거래.*성공/)).toHaveCount(0);
}
async function expectDuplicateAlert(page: Page, fixture: RecoveryFamily, candidateIds: string[]) {
  const root = page.getByTestId("deposit-transaction-form"), alert = root.getByRole("alert");
  await expect(alert).toContainText("동일한 신청·금액·입금자명·입금일시의 입금 기록이 있어 새 기록을 저장하지 않았습니다.");
  await expect(alert).toContainText(`일치 후보 ${candidateIds.length}건:`);
  for (const id of candidateIds) await expect(alert).toContainText(id);
  await expect(alert).toContainText(`가족 상세: ${recoveryPath(fixture)}`);
  await expect(alert).toContainText("기존 입금 기록과 은행 거래를 확인해주세요.");
  await expect(alert).toContainText("정상 별도 입금으로 확인되어도 별도 절차가 필요합니다.");
  await expect(root.getByRole("status")).toHaveCount(0);
  await expect(page.getByTestId("workflow-status")).not.toContainText("저장 결과와 최신 서버 원장을 확인했습니다");
}

test.describe("C11 residual risk: real ADMIN browser plus independent PG evidence (CI only)", () => {
  test.use({ storageState: process.env.UX_ADMIN_STORAGE_STATE });

  for (const disposition of ["commit", "rollback"] as const) {
    test(`S2-precommit ${disposition}-after-disconnect: observed ReturnObligation wait before closing original context`, async ({ browser }, info) => {
      expect(process.env.UX_ADMIN_STORAGE_STATE, "BLOCKED without the authenticated synthetic ADMIN harness").toBeTruthy();
      const db = new PrismaClient();
      const original = await freshRecoveryContext(browser, info);
      let fixture: RecoveryFamily | undefined;
      let hold: Awaited<ReturnType<typeof holdBrowserRow>> | undefined;
      try {
        fixture = await createRecoveryFamily(db);
        const page = await original.newPage(); await page.goto(recoveryPath(fixture));
        await saveRecoveryDeposit(page, 100000);
        const obligation = await rejectRecoverySibling(page, db, fixture);
        const reason = "합성 C11 precommit 최초 반환";
        const key = await prepareRecoveryReturn(page, obligation.id, 20000, reason);
        const before = await recoverySnapshot(db, fixture);
        hold = await holdBrowserRow("ReturnObligation", obligation.id);
        await page.getByTestId(`return-obligation-${obligation.id}`).getByRole("button", { name: "반환 이체 기록", exact: true }).click();
        const backend = await hold.blocked(); // Real server PID, row-lock wait + blocker; no sleep inference.
        expect(await recoverySnapshot(db, fixture)).toEqual(before);
        await original.close();
        if (disposition === "rollback") await hold.terminate(backend);
        await hold.release();
        if (disposition === "commit") await expect.poll(() => db.applicationReturn.count({ where: { idempotencyKey: key } })).toBe(1);
        await hold.drained();
        const after = await recoverySnapshot(db, fixture); // independent new snapshot after original tx ended
        if (disposition === "rollback") expect(after).toEqual(before);
        else {
          expect(after.returns).toHaveLength(1);
          expect(after.returns[0]).toMatchObject({ returnObligationId: obligation.id, idempotencyKey: key, amount: 20000,
            reason, returnedAt: new Date("2026-01-01T00:30:00.000Z") });
          expect(after.obligations[0]).toMatchObject({ id: obligation.id, amount: 60000, returnedAmount: 20000, resolvedAt: null });
          expect(after.deposits).toEqual(before.deposits); expect(after.allocations).toEqual(before.allocations);
          expect(after.applications).toEqual(before.applications); expect(after.mappings).toHaveLength(0);
          expect(after.reservations).toHaveLength(0); expect(after.items).toHaveLength(0); expect(after.payments).toHaveLength(0);
        }
        const T = disposition === "commit" ? 20000 : 0;
        await assertFamilyLedger(db, fixture.submissionId, { D: 100000, A: 40000, P: 0, R: 60000 - T, T });
        const reopened = await freshRecoveryContext(browser, info);
        try {
          const recovered = await reopened.newPage(); await recovered.goto(recoveryPath(fixture));
          await expectRecoveryAmounts(recovered, { D: 100000, A: 40000, P: 0, R: 60000 - T, T });
          await recovered.getByRole("link", { name: "전체 반환 대상 보기", exact: true }).click();
          const card = recovered.getByTestId(`return-obligation-${obligation.id}`);
          await expect(card.getByTestId("return-obligation-remaining")).toHaveText(`${(60000 - T).toLocaleString("ko-KR")}원`);
          await card.getByText(`반환 내역 펼치기 (${after.returns.length}건)`, { exact: true }).click();
          if (disposition === "commit") {
            await expect(card).toContainText(`반환 기록 ${after.returns[0].id}`);
            await expect(card).toContainText(reason); await expect(card).toContainText("20,000원");
            // Known original key + original payload: read-only receipt correspondence, no re-record.
            await card.getByLabel("다른 브라우저의 기존 거래 식별자", { exact: true }).fill(key);
            await card.getByRole("button", { name: "기존 거래 조회 준비", exact: true }).click();
            await card.getByLabel("실제 반환 금액", { exact: true }).fill("20000");
            await card.getByLabel("실제 반환일시 (KST)", { exact: true }).fill(recoveryDate);
            await card.getByLabel("반환 사유", { exact: true }).fill(reason);
            await card.getByRole("button", { name: "저장 결과 조회", exact: true }).click();
            await expect(card.getByRole("status")).toContainText("저장 기록 확인됨");
          } else {
            await expect(card).toContainText("완료 반환 기록 없음");
            await expect(card.locator('input[name="idempotencyKey"]')).toHaveValue("");
          }
          expect(await recoverySnapshot(db, fixture)).toEqual(after);
        } finally { await reopened.close(); }
      } finally {
        await original.close();
        if (hold) { try { await hold.release(); await hold.drained(); } finally { await hold.dispose(); } }
        try { if (fixture) await cleanupResidualFamily(db, fixture); } finally { await db.$disconnect(); }
      }
    });
  }

  for (const disposition of ["commit", "rollback"] as const) {
    test(`S5B ${disposition}: fresh lookup while original Deposit waits shows absence; specific-request identification remains LIMIT`, async ({ browser }, info) => {
      expect(process.env.UX_ADMIN_STORAGE_STATE, "BLOCKED without the authenticated synthetic ADMIN harness").toBeTruthy();
      const db = new PrismaClient();
      const original = await freshRecoveryContext(browser, info), lookup = await freshRecoveryContext(browser, info);
      let fixture: RecoveryFamily | undefined;
      let hold: Awaited<ReturnType<typeof holdBrowserRow>> | undefined;
      try {
        fixture = await createRecoveryFamily(db);
        const page = await original.newPage(); await page.goto(recoveryPath(fixture));
        const key = await prepareRecoveryDeposit(page, 100000);
        // Prepare the fresh context before holding: browser compilation is not part of the lock interval.
        const other = await lookup.newPage(); await other.goto(recoveryPath(fixture));
        const lookupForm = await prepareDepositLookup(other, key, 100000);
        const before = await recoverySnapshot(db, fixture);
        hold = await holdBrowserRow("ReservationApplicationSubmission", fixture.submissionId);
        await page.getByRole("button", { name: "실제 입금 기록", exact: true }).click();
        const backend = await hold.blocked();
        await lookupForm.getByRole("button", { name: "저장 결과 조회", exact: true }).click();
        await expect(lookupForm.getByRole("alert")).toContainText("저장 기록이 없습니다.");
        await expect(lookupForm.getByRole("status")).toHaveCount(0);
        // A fresh-context not-found is absence only. Soft assertions keep later commit/rollback evidence running.
        // These intentionally fail if the product labels lookup absence as a failed save.
        await expect(other.getByTestId("workflow-status")).not.toContainText("저장·서버 원장 확인 중…");
        expect.soft(await other.getByTestId("workflow-status").innerText()).not.toMatch(/처리 실패|저장 실패|롤백|저장되지 않았|저장에 실패/);
        expect.soft(await lookupForm.getByRole("alert").innerText()).not.toMatch(/저장 실패|롤백|저장에 실패/);
        expect(await recoverySnapshot(db, fixture)).toEqual(before); // no visible committed rows while server waits
        await original.close();
        if (disposition === "rollback") await hold.terminate(backend);
        await hold.release();
        if (disposition === "commit") await expect.poll(() => db.applicationDeposit.count({ where: { idempotencyKey: key } })).toBe(1);
        await hold.drained();
        const after = await recoverySnapshot(db, fixture);
        if (disposition === "rollback") expect(after).toEqual(before); // independent rollback evidence, never not-found alone
        else {
          expect(after.deposits).toHaveLength(1); expect(after.deposits[0]).toMatchObject({ idempotencyKey: key, amount: 100000,
            payerName: recoveryPayer, depositedAt: new Date("2026-01-01T00:30:00.000Z") });
          expect(after.obligations).toHaveLength(0); expect(after.allocations).toHaveLength(0); expect(after.returns).toHaveLength(0);
          expect(after.mappings).toHaveLength(0); expect(after.reservations).toHaveLength(0); expect(after.items).toHaveLength(0); expect(after.payments).toHaveLength(0);
        }
        const finalContext = await freshRecoveryContext(browser, info);
        try {
          const finalPage = await finalContext.newPage(); await finalPage.goto(recoveryPath(fixture));
          const finalForm = await prepareDepositLookup(finalPage, key, 100000);
          await finalForm.getByRole("button", { name: "저장 결과 조회", exact: true }).click();
          if (disposition === "commit") {
            await expect(finalForm.getByRole("status")).toContainText("저장 기록 확인됨");
            await finalPage.getByText("실제 입금 및 배정 거래 내역 (1건)", { exact: true }).click();
            await expect(finalPage.getByTestId("detail-ledger")).toContainText(`입금 기록 ${after.deposits[0].id}`);
          } else {
            await expect(finalForm.getByRole("alert")).toContainText("저장 기록이 없습니다.");
            await expect(finalForm.getByRole("status")).toHaveCount(0);
            expect.soft(await finalPage.getByTestId("workflow-status").innerText()).not.toMatch(/처리 실패|저장 실패|롤백/);
          }
          const amount = disposition === "commit" ? 100000 : 0;
          await expectRecoveryAmounts(finalPage, { D: amount, A: amount, P: 0, R: 0, T: 0 });
          await assertFamilyLedger(db, fixture.submissionId, { D: amount, A: amount, P: 0, R: 0, T: 0 });
          expect(await recoverySnapshot(db, fixture)).toEqual(after);
          // LIMIT: not-found at lookup time cannot separate uncommitted, never submitted and rolled back.
          // New-key retry mitigation is established only by the separate T02/T03 PG cells.
        } finally { await finalContext.close(); }
      } finally {
        await Promise.all([original.close(), lookup.close()]);
        if (hold) { try { await hold.release(); await hold.drained(); } finally { await hold.dispose(); } }
        try { if (fixture) await cleanupResidualFamily(db, fixture); } finally { await db.$disconnect(); }
      }
    });
  }

  for (const candidateCount of [1, 2]) {
    test(`${candidateCount === 2 ? "S5A / " : ""}T09 real duplicate form alert preserves all ${candidateCount} candidate IDs and allocation chains`, async ({ page }) => {
      expect(process.env.UX_ADMIN_STORAGE_STATE, "BLOCKED without the authenticated synthetic ADMIN harness").toBeTruthy();
      const db = new PrismaClient(); let fixture: RecoveryFamily | undefined;
      try {
        fixture = await createRecoveryFamily(db);
        if (candidateCount === 1) {
          await page.goto(recoveryPath(fixture)); await saveRecoveryDeposit(page, 50000);
          await rejectRecoverySibling(page, db, fixture);
        } else {
          // Past-data reproduction ONLY. Each historical deposit has its own fully funded allocation chain.
          // No guard bypass is added to the product and no existing financial row is edited.
          const submissionId = fixture.submissionId;
          await db.$transaction(async (tx) => {
            for (let index = 0; index < candidateCount; index++) {
              const deposit = await tx.applicationDeposit.create({ data: { submissionId, amount: 50000,
                payerName: recoveryPayer, depositedAt: new Date("2026-01-01T00:30:00.000Z"), confirmedAt: new Date("2026-01-03T00:00:00Z"),
                confirmedById: process.env.E2E_UX_ADMIN_ID!, idempotencyKey: null } });
              const obligation = await tx.returnObligation.create({ data: { submissionId, kind: "EXCESS", amount: 50000 } });
              await tx.fundAllocation.create({ data: { depositId: deposit.id, returnObligationId: obligation.id, amount: 50000 } });
            }
          });
          await page.goto(recoveryPath(fixture));
        }
        const before = await recoverySnapshot(db, fixture);
        expect(before.deposits).toHaveLength(candidateCount);
        expect(before.allocations).toHaveLength(candidateCount);
        const expectedR = candidateCount === 1 ? 50000 : 100000;
        await expectRecoveryAmounts(page, { D: 50000 * candidateCount, A: 0, P: 0, R: expectedR, T: 0 });
        await assertFamilyLedger(db, fixture.submissionId, { D: 50000 * candidateCount, A: 0, P: 0, R: expectedR, T: 0 });
        await page.getByText(`실제 입금 및 배정 거래 내역 (${candidateCount}건)`, { exact: true }).click();
        for (const deposit of before.deposits) {
          const article = page.getByTestId("detail-ledger").getByRole("article").filter({ has: page.getByRole("heading", { name: `입금 기록 ${deposit.id}`, exact: true }) });
          await expect(article).toBeVisible();
          await expect(article.getByRole("status")).toHaveCount(0);
          await expect(article).not.toContainText(/원래 요청.*성공|원 거래.*성공|저장 기록 확인됨/);
          const allocations = before.allocations.filter((row) => row.depositId === deposit.id);
          expect(allocations).toHaveLength(1);
          await expect(article).toContainText(`배정 ${allocations[0].id}`);
          await expect(article).toContainText("50,000원");
          await expect(article.getByRole("link", { name: "예약 전 반환 배정", exact: true })).toHaveAttribute("href", `#return-${allocations[0].returnObligationId}`);
        }
        if (candidateCount === 2) await expectNoClaimOfOriginalSuccess(page);
        const key = await prepareRecoveryDeposit(page, 50000);
        expect(before.deposits.every((row) => row.idempotencyKey !== key)).toBe(true);
        await page.getByRole("button", { name: "실제 입금 기록", exact: true }).click();
        await expectDuplicateAlert(page, fixture, before.deposits.map((row) => row.id));
        expect(await recoverySnapshot(db, fixture)).toEqual(before);
        // Single-candidate fixture remains exactly one Deposit; multi fixture remains its two original records.
        expect(await db.applicationDeposit.count({ where: { submissionId: fixture.submissionId } })).toBe(candidateCount);
      } finally { try { if (fixture) await cleanupResidualFamily(db, fixture); } finally { await db.$disconnect(); } }
    });
  }
});
