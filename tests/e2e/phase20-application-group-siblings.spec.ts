import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { formatKstDateTime } from "@/lib/classes/datetime";
import { phase20SyntheticMarker } from "@/lib/e2e/phase20-cleanup";
import { APPLICATION_CLOSED_MESSAGE } from "@/lib/reservation-applications/constants";
import { submitAndExpectPublicCompletion } from "./support/public-completion";
import { confirmSelectedApplications } from "./support/phase20-action";
import { hasActivePhase20PreviewLease, parseAndVerifySignedPreviewRun } from "@/lib/e2e/phase20-lease";
import { assertPreviewE2eRunnerProof } from "@/lib/e2e/preview-runner";

const SYNTHETIC_SETTINGS = { bankName: "테스트은행", accountNumber: "000000", accountHolder: "테스트", blogUrl: "https://example.test/blog", instagramUrl: "https://example.test/instagram", kakaoChannelUrl: "https://example.test/kakao" };
type OwnedSchedule = { id: string; startsAt: Date; applicationPrice: number; programName: string };

function sameIds(left: readonly string[], right: readonly string[]) { return left.length === right.length && [...left].sort().every((id, index) => id === [...right].sort()[index]); }
function hasAllIds(actual: readonly string[], expected: readonly string[]) { return expected.every((id) => actual.includes(id)); }
async function expectClosedApplicationNotice(page: Page) { await expect(page.getByTestId("application-closed")).toHaveText(APPLICATION_CLOSED_MESSAGE); }
function createLabel(schedule: OwnedSchedule) { return `${schedule.programName} · ${formatKstDateTime(schedule.startsAt)} · ${schedule.applicationPrice.toLocaleString("ko-KR")}원`; }
function editLabel(schedule: OwnedSchedule) { return `${schedule.programName} · ${formatKstDateTime(schedule.startsAt)} · ${schedule.applicationPrice.toLocaleString("ko-KR")}원`; }
function pastKstDateTimeLocal() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(Date.now() - 60_000)); const field = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value; return `${field("year")}-${field("month")}-${field("day")}T${field("hour")}:${field("minute")}`; }

async function loginAsAdmin(page: Page) {
  const email = process.env.ADMIN_EMAIL; const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Preview E2E requires its configured ADMIN credentials");
  await page.goto("/login"); await page.getByLabel("이메일").fill(email); await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click(); await expect(page).toHaveURL(/\/dashboard/);
}

/** Tags only a group whose newly-created classes prove test ownership. */
async function tagExactOwnedGroup(prisma: PrismaClient, input: { actorId: string; classIds: string[]; runId: string }) {
  const candidates = await prisma.reservationApplicationGroup.findMany({ where: { createdById: input.actorId, OR: [{ syntheticRunId: null }, { syntheticRunId: input.runId }], classes: { some: { classScheduleId: { in: input.classIds } } } }, select: { id: true, syntheticRunId: true, classes: { select: { classScheduleId: true } } } });
  const exact = candidates.filter((group) => sameIds(group.classes.map((item) => item.classScheduleId), input.classIds));
  if (exact.length === 0) return null;
  if (exact.length !== 1) throw new Error("Phase20 group recovery is ambiguous");
  const group = exact[0]!;
  if (group.syntheticRunId === null) await prisma.reservationApplicationGroup.update({ where: { id: group.id }, data: { syntheticRunId: input.runId, syntheticSettings: SYNTHETIC_SETTINGS } });
  return group.id;
}

/** After an edit, original owned classes must remain a subset; exact equality would wrongly fail. */
async function ensureTaggedKnownGroup(prisma: PrismaClient, input: { groupId: string; actorId: string; initialClassIds: string[]; runId: string }) {
  const group = await prisma.reservationApplicationGroup.findUnique({ where: { id: input.groupId }, select: { id: true, createdById: true, syntheticRunId: true, classes: { select: { classScheduleId: true } } } });
  if (!group || group.createdById !== input.actorId || !hasAllIds(group.classes.map((item) => item.classScheduleId), input.initialClassIds)) throw new Error("Phase20 group recovery ownership proof failed");
  if (group.syntheticRunId === null) await prisma.reservationApplicationGroup.update({ where: { id: group.id }, data: { syntheticRunId: input.runId, syntheticSettings: SYNTHETIC_SETTINGS } });
  else if (group.syntheticRunId !== input.runId) throw new Error("Phase20 group recovery found a non-owned synthetic group");
}

async function fillChild(page: Page, ordinal: number, childName: string, birthDate: string, classId: string) {
  const child = page.getByRole("group", { name: `아이 ${ordinal}` });
  await child.getByLabel(`아이 ${ordinal} 클래스`).selectOption(classId); await child.getByLabel("아이 이름").fill(childName); await child.getByLabel("생년월일").fill(birthDate);
  for (const checkbox of await child.getByTestId("application-consents").getByRole("checkbox").all()) await checkbox.check();
}
async function fillPublicSiblingSubmission(page: Page, input: { guardian: string; payer: string; firstChild: string; secondChild: string; firstClassId: string; secondClassId: string }) {
  await page.getByLabel("보호자 이름").fill(input.guardian); await page.getByLabel("보호자 연락처").fill("010-1234-5678"); await page.getByLabel("입금자명").fill(input.payer); await page.getByLabel("아이와의 관계").selectOption("MOTHER");
  await fillChild(page, 1, input.firstChild, "2020-01-01", input.firstClassId); await page.getByRole("button", { name: "아이 추가" }).click(); await fillChild(page, 2, input.secondChild, "2021-01-01", input.secondClassId);
}

// A/B: before test-owned synthetic groups exist, random group capabilities stay closed.
test.describe("Phase 20 group sibling boundary", () => {
  test("A. rejects an unknown group capability", async ({ page }) => {
    await page.goto("/apply/group/invalid-phase20-capability");
    await expectClosedApplicationNotice(page);
  });

  test("B. does not reveal a completion guide without its short capability", async ({ page }) => {
    await page.goto("/apply/complete");
    expect(await page.getByText("무통장 입금 안내").count().then(Boolean)).toBe(false);
  });

  test("A/B. ADMIN group controls reject a stale class and confirm two quoted siblings", async ({ page, context }) => {
    test.skip(process.env.PLAYWRIGHT_PREVIEW_E2E !== "1", "Preview wrapper lease is required before fixture writes");
    test.setTimeout(180_000);
    const prisma = new PrismaClient(); const runId = process.env.YAHO_E2E_RUN_ID as string; const marker = phase20SyntheticMarker(runId);
    const guardian = `${marker}abg`; const payer = `${marker}abp`; const firstChild = `${marker}abs1`; const secondChild = `${marker}abs2`;
    let creationAttempted = false; let createdGroupId: string | null = null; let actorId: string | null = null; let initialClassIds: string[] = [];
    try {
      const configuredAdminEmail = process.env.ADMIN_EMAIL;
      if (!configuredAdminEmail) throw new Error("Preview E2E requires its configured ADMIN credentials");
      const admin = await prisma.user.findFirst({ where: { email: configuredAdminEmail, role: "ADMIN", isActive: true }, select: { id: true } });
      if (!admin) throw new Error("Preview E2E requires its existing ADMIN fixture");
      actorId = admin.id;
      const program = await prisma.program.create({ data: { name: `${marker}ab`, defaultPrice: 0 }, select: { id: true, name: true } });
      const start = new Date(Date.now() + 14 * 86_400_000);
      const schedules = await Promise.all([10_000, 12_000, 14_000].map(async (applicationPrice, index): Promise<OwnedSchedule> => { const startsAt = new Date(start.getTime() + index * 86_400_000); const row = await prisma.classSchedule.create({ data: { programId: program.id, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), location: `${marker}ab`, capacity: 8, applicationPrice }, select: { id: true } }); return { ...row, startsAt, applicationPrice, programName: program.name }; }));
      const [first, second, removed] = schedules;
      initialClassIds = [first!.id, second!.id];

      await loginAsAdmin(page); await page.goto("/reservation-applications/groups");
      await page.getByLabel(createLabel(first!)).check(); await page.getByLabel(createLabel(second!)).check();
      creationAttempted = true;
      await page.getByRole("button", { name: "그룹 만들기" }).click();
      await expect(page.getByText("그룹을 만들었습니다. 목록에서 링크를 발급해주세요.")).toBeVisible();
      createdGroupId = await tagExactOwnedGroup(prisma, { actorId, classIds: initialClassIds, runId });
      if (!createdGroupId) throw new Error("Phase20 group creation did not produce an owned group");

      await page.goto(`/reservation-applications/groups/${createdGroupId}`);
      await page.getByLabel(editLabel(removed!)).check(); await page.getByRole("button", { name: "구성 저장" }).click();
      await expect.poll(async () => (await prisma.reservationApplicationGroup.findUnique({ where: { id: createdGroupId! }, select: { classes: { select: { classScheduleId: true } } } }))?.classes.map((item) => item.classScheduleId).sort()).toEqual([first!.id, second!.id, removed!.id].sort());
      await page.getByRole("button", { name: "접수 링크 발급·재발급" }).click();
      const oldGroupUrl = await page.getByLabel("신청 그룹 링크").inputValue();

      const stalePage = await context.newPage(); await stalePage.goto(oldGroupUrl);
      await fillPublicSiblingSubmission(stalePage, { guardian, payer, firstChild, secondChild, firstClassId: first!.id, secondClassId: removed!.id });
      await page.getByLabel(editLabel(removed!)).uncheck(); await page.getByRole("button", { name: "구성 저장" }).click();
      await expect.poll(async () => (await prisma.reservationApplicationGroup.findUnique({ where: { id: createdGroupId! }, select: { classes: { select: { classScheduleId: true } } } }))?.classes.map((item) => item.classScheduleId).sort()).toEqual(initialClassIds.slice().sort());
      await stalePage.getByRole("button", { name: "신청하기" }).click(); await expect(stalePage.getByRole("alert")).toBeVisible(); expect(await stalePage.getByRole("alert").count().then(Boolean)).toBe(true);
      expect(await prisma.reservationApplication.count({ where: { submission: { groupId: createdGroupId } } })).toBe(0); await stalePage.close();

      await page.getByRole("button", { name: "접수 중지" }).click(); await expect(page.getByText("중지된 그룹입니다. 새 링크를 발급하면 다시 접수합니다.")).toBeVisible();
      await page.goto(oldGroupUrl); await expectClosedApplicationNotice(page);
      await page.goto(`/reservation-applications/groups/${createdGroupId}`); await page.getByRole("button", { name: "접수 재개·새 링크 발급" }).click();
      const newGroupUrl = await page.getByLabel("신청 그룹 링크").inputValue();
      await page.goto(oldGroupUrl); await expectClosedApplicationNotice(page);

      await page.goto(newGroupUrl); await fillPublicSiblingSubmission(page, { guardian, payer, firstChild, secondChild, firstClassId: first!.id, secondClassId: second!.id });
      await submitAndExpectPublicCompletion(page);
      if (process.env.PREVIEW_E2E_FOCUS === "MINIMAL") {
        await expect(page.getByText("22,000원", { exact: true })).toBeVisible();
        await expect(page.getByText(SYNTHETIC_SETTINGS.bankName, { exact: true })).toBeVisible();
        return;
      }
      const submission = await prisma.reservationApplicationSubmission.findFirstOrThrow({ where: { groupId: createdGroupId }, select: { id: true, applications: { select: { id: true, classScheduleId: true, quotedAmount: true } } } });
      const submittedQuotes = new Map(submission.applications.map((application) => [application.classScheduleId, application.quotedAmount]));
      expect(submission.applications).toHaveLength(2); expect(submittedQuotes.get(first!.id) === 10_000 && submittedQuotes.get(second!.id) === 12_000).toBe(true);

      await loginAsAdmin(page); await page.goto(`/reservation-applications/submissions/${submission.id}`);
      await page.locator('input[name="amount"]').fill("22000"); await page.locator('input[name="payerName"]').fill(payer); await page.locator('input[name="depositedAt"]').fill(pastKstDateTimeLocal());
      await page.getByRole("button", { name: "실제 입금 기록" }).click(); await expect(page.getByText("현재 가용 입금액 22,000원", { exact: true })).toBeVisible();
      for (const checkbox of await page.getByLabel("확정", { exact: true }).all()) await checkbox.check();
      const firstCandidate = page.getByLabel(`${firstChild} 확정 대상`); const secondCandidate = page.getByLabel(`${secondChild} 확정 대상`);
      expect((await firstCandidate.inputValue() === "NEW") && (await secondCandidate.inputValue() === "NEW")).toBe(true);
      await confirmSelectedApplications(page, { prisma, submissionId: submission.id, applicationIds: submission.applications.map((application) => application.id), childNames: [firstChild, secondChild], ownedCounts: async () => {
        assertPreviewE2eRunnerProof({ proofPath: process.env.PREVIEW_E2E_RUNNER_PROOF_PATH, proof: process.env.PREVIEW_E2E_RUNNER_PROOF });
        const environment = { ...process.env, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: process.env.PREVIEW_E2E_DEPLOYMENT_SHA };
        const signed = parseAndVerifySignedPreviewRun(process.env.PREVIEW_E2E_PHASE20_SIGNED_RUN ?? null, environment);
        if (!await hasActivePhase20PreviewLease(prisma, { signed, syntheticRunId: runId, now: new Date(), environment })) throw new Error("P20_ACTION_OWNED_AUDIT_GUARD_DENIED");
        return prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          const owned = await tx.reservationApplicationSubmission.count({ where: { id: submission.id, groupId: createdGroupId, group: { syntheticRunId: runId } } });
          if (owned !== 1) throw new Error("P20_ACTION_OWNED_AUDIT_SCOPE_DENIED");
          return { reservations: await tx.reservation.count({ where: { applications: { some: { submissionId: submission.id } } } }), mappings: await tx.reservationApplicationPaymentMapping.count({ where: { application: { submissionId: submission.id } } }) };
        }, { maxWait: 10_000, timeout: 30_000 });
      } });

      const confirmed = await prisma.reservationApplication.findMany({
        where: { id: { in: submission.applications.map((application) => application.id) } },
        select: {
          classScheduleId: true,
          reservation: { select: { id: true, classScheduleId: true } },
          paymentMapping: { select: { paymentItem: { select: { paymentId: true, amount: true, reservation: { select: { classScheduleId: true } } } } } },
        },
      });
      const reservationIds = confirmed.flatMap((application) => application.reservation?.id ? [application.reservation.id] : []); const paymentIds = confirmed.flatMap((application) => application.paymentMapping?.paymentItem.paymentId ? [application.paymentMapping.paymentItem.paymentId] : []);
      expect(confirmed).toHaveLength(2); expect(new Set(reservationIds).size === 2 && new Set(paymentIds).size === 1).toBe(true);
      expect(confirmed.every((application) => application.reservation?.classScheduleId === application.classScheduleId && application.paymentMapping?.paymentItem.reservation.classScheduleId === application.classScheduleId)).toBe(true);
      const payment = await prisma.payment.findUnique({ where: { id: paymentIds[0]! }, select: { totalAmount: true, items: { select: { amount: true, reservation: { select: { classScheduleId: true } } } } } });
      expect(payment?.totalAmount).toBe(22_000);
      expect(payment?.items.length === 2 && payment.items.every((item) => (item.reservation.classScheduleId === first!.id && item.amount === 10_000) || (item.reservation.classScheduleId === second!.id && item.amount === 12_000))).toBe(true);
    } finally {
      try {
        if (creationAttempted && actorId) {
          if (createdGroupId) await ensureTaggedKnownGroup(prisma, { groupId: createdGroupId, actorId, initialClassIds, runId });
          else await tagExactOwnedGroup(prisma, { actorId, classIds: initialClassIds, runId });
        }
      } finally {
        await prisma.$disconnect();
      }
    }
  });
});
