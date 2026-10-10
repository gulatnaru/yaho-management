import { expect, test, type Browser, type Cookie, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { phase20SyntheticMarker, registerPhase20OwnedChildren } from "@/lib/e2e/phase20-cleanup";
import { parseAndVerifySignedPreviewRun } from "@/lib/e2e/phase20-lease";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { APPLICATION_CLOSED_MESSAGE } from "@/lib/reservation-applications/constants";
import { revokeApplicationDeviceCore } from "@/server/reservation-applications/devices";
import { createApplicationGroupCore, issueApplicationGroupLinkCore } from "@/server/reservation-applications/groups";
import { purgeExpiredPersonalDataCore } from "@/server/reservation-applications/retention";
import { submitAndExpectPublicCompletion } from "./support/public-completion";
import { confirmSelectedApplications, clickAndExpectPhase20Action, recordPhase20Stage } from "./support/phase20-action";

const SYNTHETIC_SETTINGS = { bankName: "테스트은행", accountNumber: "000000", accountHolder: "테스트", blogUrl: "https://example.test/blog", instagramUrl: "https://example.test/instagram", kakaoChannelUrl: "https://example.test/kakao" };
type Fixture = { groupId: string; token: string; scheduleId: string };

function pastKstDateTimeLocal() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(Date.now() - 60_000));
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${field("year")}-${field("month")}-${field("day")}T${field("hour")}:${field("minute")}`;
}

async function expectClosedApplicationNotice(page: Page) { await expect(page.getByTestId("application-closed")).toHaveText(APPLICATION_CLOSED_MESSAGE); }

async function loginAsAdmin(page: Page) {
  const email = process.env.ADMIN_EMAIL; const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Preview E2E requires its configured ADMIN credentials");
  await page.goto("/login"); await page.getByLabel("이메일").fill(email); await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click(); await expect(page).toHaveURL(/\/dashboard/);
}

async function isolatedPublicContext(browser: Browser, cookie?: Cookie) {
  const use = test.info().project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, extraHTTPHeaders: use.extraHTTPHeaders });
  if (cookie) await context.addCookies([cookie]);
  return context;
}

async function repeatProfileIsEmpty(context: Awaited<ReturnType<typeof isolatedPublicContext>>) {
  const response = await context.request.get("/api/reservation-applications/repeat-children");
  const profile = await response.json() as { guardian?: unknown; children?: unknown[] };
  return response.ok() && profile.guardian === null && Array.isArray(profile.children) && profile.children.length === 0;
}

async function createFixture(prisma: PrismaClient, input: { adminId: string; runId: string; marker: string; suffix: string; offsetDays: number }): Promise<Fixture> {
  const program = await prisma.program.create({ data: { name: `${input.marker}${input.suffix}`, defaultPrice: 0 }, select: { id: true } });
  const startsAt = new Date(Date.now() + input.offsetDays * 86_400_000);
  const schedule = await prisma.classSchedule.create({ data: { programId: program.id, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), location: `${input.marker}${input.suffix}`, capacity: 8, applicationPrice: 10_000 }, select: { id: true } });
  const group = await createApplicationGroupCore(prisma, { classScheduleIds: [schedule.id], actorUserId: input.adminId, now: new Date(), syntheticRunId: input.runId, syntheticSettings: SYNTHETIC_SETTINGS });
  const link = await issueApplicationGroupLinkCore(prisma, { groupId: group.groupId, actorUserId: input.adminId, now: new Date() });
  return { groupId: group.groupId, token: link.token, scheduleId: schedule.id };
}

async function acceptConsents(page: Page, ordinal = 1) {
  const child = page.getByRole("group", { name: `아이 ${ordinal}` });
  for (const checkbox of await child.getByTestId("application-consents").getByRole("checkbox").all()) await checkbox.check();
}

async function submitNewGuardian(page: Page, input: { path: string; guardian: string; payer: string; child: string; classId: string; requestNote?: string }) {
  await page.goto(input.path);
  await page.getByLabel("보호자 이름").fill(input.guardian); await page.getByLabel("보호자 연락처").fill("010-1234-5678"); await page.getByLabel("입금자명").fill(input.payer); await page.getByLabel("아이와의 관계").selectOption("MOTHER");
  const child = page.getByRole("group", { name: "아이 1" });
  await child.getByLabel("아이 1 클래스").selectOption(input.classId); await child.getByLabel("아이 이름").fill(input.child); await child.getByLabel("생년월일").fill("2020-01-01");
  if (input.requestNote) await child.getByLabel("요청사항").fill(input.requestNote);
  await acceptConsents(page); await submitAndExpectPublicCompletion(page);
}

async function issueCompanionUrl(page: Page) {
  const previous = await page.evaluate(() => navigator.clipboard.readText());
  await clickAndExpectPhase20Action(page, page.getByRole("button", { name: "동행 초대 링크 만들기", exact: true }), page.getByRole("status").filter({ hasText: /^동행 초대 링크를 만들었습니다\.$/ }), Date.now, "INVITE_ISSUE");
  await page.getByRole("button", { name: "초대 링크 복사" }).click();
  await expect(page.getByRole("status")).toHaveText("복사했습니다.");
  const current = await page.evaluate(() => navigator.clipboard.readText());
  expect(current !== previous).toBe(true);
  return current;
}

// E/F/G/H: opaque invitation and device endpoints fail closed without their own capability scope.
test.describe("Phase 20 companion and repeat privacy boundary", () => {
  test("E. rejects an unknown companion invitation", async ({ page }) => {
    await page.goto("/apply/companion/invalid-phase20-capability");
    await expectClosedApplicationNotice(page);
  });

  test("F. returns an empty device-scoped repeat DTO without a device cookie", async ({ request }) => {
    const response = await request.get("/api/reservation-applications/repeat-children");
    const payload = await response.json() as { guardian?: unknown; children?: unknown[] };
    expect(response.ok() && payload.guardian === null && Array.isArray(payload.children) && payload.children.length === 0).toBe(true);
  });

  test("G. keeps invalid invite navigation closed after a reload", async ({ page }) => {
    await page.goto("/apply/companion/invalid-phase20-capability"); await page.reload();
    await expectClosedApplicationNotice(page);
  });

  test("H. has no publicly addressable child repeat selector", async ({ page }) => {
    await page.goto("/apply/group/invalid-phase20-capability");
    expect(await page.getByLabel(/기존 아이/).count().then(Boolean)).toBe(false);
  });
});

test("E/F/G/H. owned device rotation, companion consent, and scoped purge stay capability-bound", async ({ page, browser }: { page: Page; browser: Browser }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW_E2E !== "1", "Preview wrapper lease is required before fixture writes");
  // Measured repeat confirmation at 286s still precedes owned purge/privacy checks.
  test.setTimeout(420_000);
  const testStartedAt = Date.now();
  const prisma = new PrismaClient(); const runId = process.env.YAHO_E2E_RUN_ID as string; const marker = phase20SyntheticMarker(runId);
  const guardian = `${marker}pvg`; const payer = `${marker}pvp`; const childName = `${marker}pvc`; const friendGuardian = `${marker}pvf`; const friendChild = `${marker}pvfc`;
  const contexts: Array<Awaited<ReturnType<typeof isolatedPublicContext>>> = [];
  try {
    const configuredAdminEmail = process.env.ADMIN_EMAIL;
    if (!configuredAdminEmail) throw new Error("Preview E2E requires its configured ADMIN credentials");
    const admin = await prisma.user.findFirst({ where: { email: configuredAdminEmail, role: "ADMIN", isActive: true }, select: { id: true } });
    if (!admin) throw new Error("Preview E2E requires its configured ADMIN fixture");
    const initialFixture = await createFixture(prisma, { adminId: admin.id, runId, marker, suffix: "pvi", offsetDays: 14 });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/apply/group/${initialFixture.token}`);
    const minimizedPublicMarkup = await page.content().then((html) => !html.includes("정원") && !html.includes("잔여석") && !html.includes("예약 가능"));
    const noMobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(minimizedPublicMarkup && noMobileOverflow).toBe(true);
    await submitNewGuardian(page, { path: `/apply/group/${initialFixture.token}`, guardian, payer, child: childName, classId: initialFixture.scheduleId, requestNote: "pvn" });
    recordPhase20Stage("INITIAL_COMPLETION", testStartedAt);
    const initialCookie = (await page.context().cookies()).find((cookie) => cookie.name === "yaho_application_device");
    expect(Boolean(initialCookie?.secure && initialCookie.httpOnly && initialCookie.sameSite === "Lax")).toBe(true);
    if (!initialCookie) throw new Error("Phase20 owner device cookie was not issued");
    const initialSubmission = await prisma.reservationApplicationSubmission.findFirstOrThrow({ where: { groupId: initialFixture.groupId }, select: { id: true, applications: { select: { id: true, requestNote: true } }, deviceSubmissions: { select: { deviceId: true } } } });
    expect(initialSubmission.applications[0]?.requestNote === "pvn").toBe(true);

    const friendInviteUrl = await issueCompanionUrl(page);
    const friendContext = await isolatedPublicContext(browser); contexts.push(friendContext);
    const friendPage = await friendContext.newPage();
    await submitNewGuardian(friendPage, { path: friendInviteUrl, guardian: friendGuardian, payer: `${marker}pvfp`, child: friendChild, classId: initialFixture.scheduleId, requestNote: "pvfn" });
    recordPhase20Stage("FRIEND_COMPLETION", testStartedAt);
    const friendCookie = (await friendContext.cookies()).find((cookie) => cookie.name === "yaho_application_device");
    if (!friendCookie) throw new Error("Phase20 companion device cookie was not issued");
    const friendProfile = await friendContext.request.get("/api/reservation-applications/repeat-children");
    const friendPayload = await friendProfile.json() as { guardian?: unknown };
    expect(friendProfile.ok() && friendPayload.guardian !== null && !JSON.stringify(friendPayload).includes(childName)).toBe(true);
    const friendSubmission = await prisma.reservationApplicationSubmission.findFirstOrThrow({ where: { groupId: initialFixture.groupId, guardianName: friendGuardian }, select: { id: true, applications: { select: { privacyConsentAgreed: true, submissionId: true } } } });
    const companion = await prisma.companionGroup.findFirstOrThrow({ where: { groupId: initialFixture.groupId, issuerSubmissionId: initialSubmission.id }, select: { members: { select: { submissionId: true } } } });
    expect(companion.members.some((member) => member.submissionId === friendSubmission.id) && friendSubmission.applications.every((application) => application.privacyConsentAgreed && application.submissionId === friendSubmission.id)).toBe(true);
    expect(await prisma.relationship.count({ where: { OR: [{ childA: { name: childName } }, { childB: { name: childName } }] } })).toBe(0);

    const expiredInviteUrl = await issueCompanionUrl(page);
    const expiringToken = new URL(expiredInviteUrl).pathname.split("/").at(-1);
    if (!expiringToken) throw new Error("P20_INVITE_CAPABILITY_UNAVAILABLE");
    const expiringInvite = await prisma.companionInvite.findFirstOrThrow({ where: { tokenHash: hashApplicationCapabilityToken(expiringToken), issuerSubmissionId: initialSubmission.id, groupId: initialFixture.groupId, group: { syntheticRunId: runId } }, select: { id: true } });
    await prisma.companionInvite.update({ where: { id: expiringInvite.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const expiredContext = await isolatedPublicContext(browser); contexts.push(expiredContext); const expiredPage = await expiredContext.newPage(); await expiredPage.goto(expiredInviteUrl);
    await expectClosedApplicationNotice(expiredPage);
    const revokedInviteUrl = await issueCompanionUrl(page);
    await clickAndExpectPhase20Action(page, page.getByRole("button", { name: "초대 취소", exact: true }), page.getByRole("status").filter({ hasText: /^동행 초대 링크를 취소했습니다\.$/ }), Date.now, "INVITE_REVOKE");
    const revokedContext = await isolatedPublicContext(browser); contexts.push(revokedContext); const revokedPage = await revokedContext.newPage(); await revokedPage.goto(revokedInviteUrl);
    await expectClosedApplicationNotice(revokedPage);
    recordPhase20Stage("INVITE_BOUNDARIES", testStartedAt);
    const revokedFixture = await createFixture(prisma, { adminId: admin.id, runId, marker, suffix: "pvv", offsetDays: 20 });
    const revokeContext = await isolatedPublicContext(browser); contexts.push(revokeContext); const revokePage = await revokeContext.newPage();
    await submitNewGuardian(revokePage, { path: `/apply/group/${revokedFixture.token}`, guardian: `${marker}pvrg`, payer: `${marker}pvrp`, child: `${marker}pvrc`, classId: revokedFixture.scheduleId });
    recordPhase20Stage("REVOKED_DEVICE_COMPLETION", testStartedAt);
    const revokeCookie = (await revokeContext.cookies()).find((cookie) => cookie.name === "yaho_application_device");
    if (!revokeCookie) throw new Error("Phase20 revocation fixture cookie was not issued");
    const revokeProfile = await revokeContext.request.get("/api/reservation-applications/repeat-children"); const revokePayload = await revokeProfile.json() as { guardian?: unknown };
    expect(revokeProfile.ok() && revokePayload.guardian !== null).toBe(true);
    expect(await revokeApplicationDeviceCore(prisma, { token: revokeCookie.value, now: new Date() })).toBe(true);
    const revokedDeviceContext = await isolatedPublicContext(browser, revokeCookie); contexts.push(revokedDeviceContext); expect(await repeatProfileIsEmpty(revokedDeviceContext)).toBe(true);

    await loginAsAdmin(page); await page.goto(`/reservation-applications/submissions/${initialSubmission.id}`);
    await page.locator('input[name="amount"]').fill("10000"); await page.locator('input[name="payerName"]').fill(payer); await page.locator('input[name="depositedAt"]').fill(pastKstDateTimeLocal()); await page.getByRole("button", { name: "실제 입금 기록" }).click(); await expect(page.getByText("현재 가용 입금액 10,000원", { exact: true })).toBeVisible();
    for (const checkbox of await page.getByLabel("확정", { exact: true }).all()) await checkbox.check();
    await confirmSelectedApplications(page, { prisma, submissionId: initialSubmission.id, applicationIds: initialSubmission.applications.map((application) => application.id), childNames: [childName] });
    recordPhase20Stage("INITIAL_CONFIRMATION", testStartedAt);
    const confirmedInitial = await prisma.reservationApplication.findUniqueOrThrow({ where: { id: initialSubmission.applications[0]!.id }, select: { childId: true, reservationId: true } });
    if (!confirmedInitial.childId || !confirmedInitial.reservationId) throw new Error("Phase20 initial confirmation did not create owned records");
    const validFriendProfile = await friendContext.request.get("/api/reservation-applications/repeat-children");
    const validFriendPayload = await validFriendProfile.json() as { guardian?: unknown; children?: Array<{ id?: string; name?: string }> };
    expect(validFriendProfile.ok() && validFriendPayload.guardian !== null && !(validFriendPayload.children ?? []).some((child) => child.id === confirmedInitial.childId || child.name === childName)).toBe(true);
    const friendDevice = await prisma.applicationDevice.findFirstOrThrow({ where: { tokenHash: hashApplicationCapabilityToken(friendCookie.value) }, select: { id: true } });
    await prisma.applicationDevice.update({ where: { id: friendDevice.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const expiredDeviceContext = await isolatedPublicContext(browser, friendCookie); contexts.push(expiredDeviceContext); expect(await repeatProfileIsEmpty(expiredDeviceContext)).toBe(true);

    const repeatFixture = await createFixture(prisma, { adminId: admin.id, runId, marker, suffix: "pvr", offsetDays: 16 });
    await page.goto(`/apply/group/${repeatFixture.token}`); await expect(page.getByLabel("아이 1 기존 아이")).toBeVisible();
    await page.getByLabel("아이 1 기존 아이").selectOption(confirmedInitial.childId); await page.getByLabel("입금자명").fill(payer); await page.getByRole("button", { name: "신청하기" }).click(); await expect(page.getByRole("alert")).toBeVisible();
    expect(await prisma.reservationApplication.count({ where: { submission: { groupId: repeatFixture.groupId } } })).toBe(0);
    await acceptConsents(page); await submitAndExpectPublicCompletion(page);
    recordPhase20Stage("REPEAT_COMPLETION", testStartedAt);
    const rotatedCookie = (await page.context().cookies()).find((cookie) => cookie.name === "yaho_application_device");
    if (!rotatedCookie) throw new Error("Phase20 rotated device cookie was not issued");
    const repeatSubmission = await prisma.reservationApplicationSubmission.findFirstOrThrow({ where: { groupId: repeatFixture.groupId }, select: { id: true, applications: { select: { id: true } } } });
    const device = await prisma.applicationDevice.findUniqueOrThrow({ where: { id: initialSubmission.deviceSubmissions[0]!.deviceId }, select: { tokenHash: true } });
    // The initial group also contains the friend's deliberately separate device.
    // Compare only this guardian's exact initial and repeat submissions.
    const sameDevice = await prisma.deviceSubmission.findMany({ where: { submissionId: { in: [initialSubmission.id, repeatSubmission.id] } }, select: { deviceId: true } });
    expect(sameDevice.length === 2 && sameDevice.every((row) => row.deviceId === initialSubmission.deviceSubmissions[0]!.deviceId)).toBe(true);
    expect(hashApplicationCapabilityToken(initialCookie.value) !== device.tokenHash).toBe(true);
    expect(hashApplicationCapabilityToken(rotatedCookie.value) === device.tokenHash).toBe(true);
    const oldCookieContext = await isolatedPublicContext(browser, initialCookie); contexts.push(oldCookieContext); expect(await repeatProfileIsEmpty(oldCookieContext)).toBe(true);
    const wrongCookieContext = await isolatedPublicContext(browser); contexts.push(wrongCookieContext); await wrongCookieContext.addCookies([{ name: "yaho_application_device", value: "wrong-phase20-capability", url: test.info().project.use.baseURL as string, secure: true, httpOnly: true, sameSite: "Lax" }]); expect(await repeatProfileIsEmpty(wrongCookieContext)).toBe(true);
    const completionStorageClear = await page.evaluate((runMarker) => [localStorage, sessionStorage].every((store) => Array.from({ length: store.length }, (_, index) => store.key(index)).every((key) => key === null || !store.getItem(key)?.includes(runMarker))), marker);
    expect(completionStorageClear).toBe(true);
    await page.goBack(); expect(await page.getByLabel("보호자 이름").count().then((count) => count === 0)).toBe(true);

    await loginAsAdmin(page); await page.goto(`/reservation-applications/submissions/${repeatSubmission.id}`);
    await page.locator('input[name="amount"]').fill("10000"); await page.locator('input[name="payerName"]').fill(payer); await page.locator('input[name="depositedAt"]').fill(pastKstDateTimeLocal()); await page.getByRole("button", { name: "실제 입금 기록" }).click(); await expect(page.getByText("현재 가용 입금액 10,000원", { exact: true })).toBeVisible();
    for (const checkbox of await page.getByLabel("확정", { exact: true }).all()) await checkbox.check(); await confirmSelectedApplications(page, { prisma, submissionId: repeatSubmission.id, applicationIds: repeatSubmission.applications.map((application) => application.id), childNames: [childName] });
    recordPhase20Stage("REPEAT_CONFIRMATION", testStartedAt);

    const staleFixture = await createFixture(prisma, { adminId: admin.id, runId, marker, suffix: "pvs", offsetDays: 18 });
    await page.goto(`/apply/group/${staleFixture.token}`); await expect(page.getByLabel("아이 1 기존 아이")).toBeVisible(); await page.getByLabel("아이 1 기존 아이").selectOption(confirmedInitial.childId); await page.getByLabel("입금자명").fill(payer); await acceptConsents(page);
    const guardEnvironment = { ...process.env, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: process.env.PREVIEW_E2E_DEPLOYMENT_SHA };
    const signed = parseAndVerifySignedPreviewRun(process.env.PREVIEW_E2E_PHASE20_SIGNED_RUN ?? null, guardEnvironment);
    if (!signed) throw new Error("Phase20 signed Preview run is unavailable");
    await registerPhase20OwnedChildren(prisma, { runId, childIds: [confirmedInitial.childId], signed, now: new Date(), environment: guardEnvironment });
    const aged = await prisma.reservationApplication.findMany({ where: { childId: confirmedInitial.childId, status: "CONFIRMED", reservationId: { not: null }, submission: { groupId: { in: [initialFixture.groupId, repeatFixture.groupId] } } }, select: { classScheduleId: true, reservationId: true } });
    expect(aged.length === 2).toBe(true);
    const agedAt = new Date(Date.now() - 6 * 365 * 86_400_000);
    await prisma.classSchedule.updateMany({ where: { id: { in: aged.map((application) => application.classScheduleId) } }, data: { startsAt: agedAt, endsAt: new Date(agedAt.getTime() + 3_600_000) } });
    await prisma.reservation.updateMany({ where: { id: { in: aged.flatMap((application) => application.reservationId ? [application.reservationId] : []) } }, data: { status: "COMPLETED" } });
    await purgeExpiredPersonalDataCore(prisma, { actorUserId: admin.id, now: new Date(), scope: { childIds: [confirmedInitial.childId], applicationIds: [] } });
    await page.getByRole("button", { name: "신청하기" }).click(); await expect(page.getByRole("alert")).toBeVisible();
    const [purgedChild, staleApplications, staleReservations, staleMappings] = await Promise.all([
      prisma.child.findUniqueOrThrow({ where: { id: confirmedInitial.childId }, select: { isActive: true, personalDataPurgedAt: true } }),
      prisma.reservationApplication.count({ where: { submission: { groupId: staleFixture.groupId } } }),
      prisma.reservation.count({ where: { childId: confirmedInitial.childId, classScheduleId: staleFixture.scheduleId, status: "RESERVED" } }),
      prisma.reservationApplicationPaymentMapping.count({ where: { application: { submission: { groupId: staleFixture.groupId } } } }),
    ]);
    expect(!purgedChild.isActive && purgedChild.personalDataPurgedAt !== null && staleApplications === 0 && staleReservations === 0 && staleMappings === 0).toBe(true);
    const purgedDeviceContext = await isolatedPublicContext(browser, rotatedCookie); contexts.push(purgedDeviceContext); expect(await repeatProfileIsEmpty(purgedDeviceContext)).toBe(true);

    const noPiiInStorage = await page.evaluate((runMarker) => [localStorage, sessionStorage].every((store) => Array.from({ length: store.length }, (_, index) => store.key(index)).every((key) => key === null || !store.getItem(key)?.includes(runMarker))), marker);
    expect(noPiiInStorage).toBe(true);
    await page.goBack(); expect(await page.getByLabel("보호자 이름").count().then((count) => count === 0)).toBe(true);
    recordPhase20Stage("PURGE_VALIDATION", testStartedAt);
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    await prisma.$disconnect();
  }
});
