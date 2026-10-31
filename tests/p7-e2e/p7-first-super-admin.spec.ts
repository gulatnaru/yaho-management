import { expect, test } from "@playwright/test";
import { compare, hash } from "bcryptjs";
// This suite must be invoked only via playwright.p7.config.ts with a disposable
// local DB. No real identities, addresses, transport or delivery provider.
test("unauthenticated requests cannot approve or execute", async ({ page }) => {
  await page.goto("/accounts/first-super-admin");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "등록 실행" })).toHaveCount(0);
});
test("invalid acceptance GET cannot consume a token", async ({ page }) => {
  await page.goto(`/first-super-admin/${"a".repeat(43)}`);
  await expect(page.getByText("유효하지 않은 링크입니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "수락" })).toHaveCount(0);
});

// The browser performs the approval, acceptance and execution. A synthetic
// capability is inserted by the isolated harness because the fake adapter does
// not expose raw tokens to ordinary HTTP responses.
test("synthetic ADMIN approval, recipient acceptance and first registration", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const { PrismaClient } = await import("@prisma/client");
  const { randomBytes, createHash } = await import("node:crypto");
  const db = new PrismaClient();
  const adminId = process.env.YAHO_P7_APPROVER_USER_ID;
  if (!adminId || !/^p7-e2e-[a-z0-9-]+$/.test(adminId)) throw new Error("P7_SYNTHETIC_APPROVER_REQUIRED");
  const suffix = crypto.randomUUID();
  const adminEmail = `${adminId}@example.test`, targetEmail = `p7-${suffix}@example.test`;
  const adminPassword = `synthetic-admin-${suffix}`, targetPassword = `synthetic-target-${suffix}`;
  let targetId = "", approvalId = "", staffId = "";
  try {
    expect(await db.bootstrapCompletion.count()).toBe(0);
    expect(await db.user.count({ where: { role: "SUPER_ADMIN" } })).toBe(0);
    await db.user.create({ data: { id: adminId, name: "Synthetic Admin", email: adminEmail, role: "ADMIN", password: await hash(adminPassword, 12) } });
    await page.goto("/login");
    await page.getByLabel("이메일").fill(adminEmail);
    await page.getByLabel("비밀번호").fill(adminPassword);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 30_000 });
    await page.goto("/accounts/first-super-admin");
    await page.getByLabel("이름").fill("Synthetic Target");
    await page.getByLabel("이메일").fill(targetEmail);
    await page.getByLabel("대면 실명 확인 시각").fill("2020-01-01T12:00");
    const prepareRequest = page.waitForRequest(r => r.method() === "POST" && Boolean(r.headers()["next-action"]));
    await page.getByRole("button", { name: "승인 및 테스트 전달" }).click();
    const capturedPrepare = await prepareRequest;
    await expect.poll(async () => db.bootstrapApproval.count({ where: { targetEmail } })).toBe(1);
    const approval = await db.bootstrapApproval.findFirstOrThrow({ where: { targetEmail } });
    approvalId = approval.id; targetId = approval.targetUserId;
    expect(approval).toMatchObject({ approverUserId: adminId, targetEmail, identityMethod: "FACE_TO_FACE" });
    expect(approval.identityAt.getTime()).toBeLessThanOrEqual(approval.approvedAt.getTime());
    await page.goto("/accounts/first-super-admin");
    await expect(page.getByText(`승인 ID: ${approvalId}`, { exact: false })).toBeVisible({ timeout: 30_000 });
    // A server action may respond with an error page on rejection. Reload the
    // real form for each attempt and assert the persisted state, not its text.
    const rejectedExecution = async (a: string, b: string) => {
      await page.goto("/accounts/first-super-admin");
      const form = page.locator("form").filter({ has: page.getByRole("button", { name: "등록 실행" }) });
      await form.getByLabel("승인 ID").fill(a);
      await form.getByLabel("수락 ID").fill(b);
      const response = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/accounts/first-super-admin");
      await form.getByRole("button", { name: "등록 실행" }).click();
      await response;
      expect(await db.bootstrapCompletion.count()).toBe(0);
      expect(await db.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ role: "STAFF", isActive: false });
    };
    // Approval exists but no acceptance has been completed.
    const pending = await db.bootstrapAcceptance.findFirstOrThrow({ where: { approvalId, acceptedAt: null, revokedAt: null } });
    await rejectedExecution(approvalId, pending.id);
    await expect(db.user.findUniqueOrThrow({ where: { id: targetId } })).resolves.toMatchObject({ role: "STAFF", isActive: false });
    const token = randomBytes(32).toString("base64url");
    await db.bootstrapAcceptance.updateMany({ where: { approvalId, acceptedAt: null }, data: { revokedAt: new Date() } });
    const acceptance = await db.bootstrapAcceptance.create({ data: { approvalId, acceptedForUserId: targetId, targetEmail, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000) } });
    await page.goto(`/first-super-admin/${token}`);
    await page.getByLabel("비밀번호", { exact: true }).fill(targetPassword);
    await page.getByLabel("비밀번호 확인").fill(targetPassword);
    const acceptanceRequest = page.waitForRequest(r => r.method() === "POST" && Boolean(r.headers()["next-action"]));
    await page.getByRole("button", { name: "수락" }).click();
    const capturedAcceptance = await acceptanceRequest;
    await expect.poll(async () => (await db.bootstrapAcceptance.findUniqueOrThrow({ where: { id: acceptance.id } })).acceptedAt).not.toBeNull();
    expect(await db.bootstrapAcceptance.findUniqueOrThrow({ where: { id: acceptance.id } })).toMatchObject({ acceptedForUserId: targetId, tokenVerified: true, authenticationMethod: "TOKEN_POSSESSION" });
    expect(await db.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ role: "STAFF", isActive: false, mustChangePassword: true });
    // A completed acceptance with no matching approval is also insufficient.
    await rejectedExecution("missing-approval", acceptance.id);
    const existingId = `p7-existing-${suffix}`;
    await db.user.create({ data: { id: existingId, name: "Synthetic Existing", email: `${existingId}@example.test`, role: "SUPER_ADMIN" } });
    try { await rejectedExecution(approvalId, acceptance.id); }
    finally { await db.user.delete({ where: { id: existingId } }); }
    // Capture the actual server action with valid evidence without executing it.
    await page.goto("/accounts/first-super-admin");
    const interceptForm = page.locator("form").filter({ has: page.getByRole("button", { name: "등록 실행" }) });
    await interceptForm.getByLabel("승인 ID").fill(approvalId);
    await interceptForm.getByLabel("수락 ID").fill(acceptance.id);
    await page.route("**/accounts/first-super-admin", route => route.request().method() === "POST" ? route.abort() : route.continue());
    const executeRequest = page.waitForRequest(r => r.method() === "POST" && Boolean(r.headers()["next-action"]));
    await interceptForm.getByRole("button", { name: "등록 실행" }).click().catch(() => {});
    const capturedExecute = await executeRequest;
    const captureAdminAction = async (button: string) => {
      await page.goto("/accounts/first-super-admin");
      const form = page.locator("form").filter({ has: page.getByRole("button", { name: button }) });
      await form.getByLabel("승인 ID").fill(approvalId);
      await page.route("**/accounts/first-super-admin", route => route.request().method() === "POST" ? route.abort() : route.continue());
      const request = page.waitForRequest(r => r.method() === "POST" && Boolean(r.headers()["next-action"]));
      await form.getByRole("button", { name: button }).click().catch(() => {});
      const captured = await request;
      await page.unroute("**/accounts/first-super-admin");
      return captured;
    };
    const capturedIssue = await captureAdminAction("토큰 재발급");
    const capturedRevoke = await captureAdminAction("승인 철회");
    await page.unroute("**/accounts/first-super-admin");
    const staffEmail = `p7-staff-${suffix}@example.test`;
    const staff = await db.user.create({ data: { name: "Synthetic Staff", email: staffEmail, password: await hash(targetPassword, 12), role: "STAFF" } });
    staffId = staff.id;
    const anonymousContext = await browser.newContext();
    const deniedStaffContext = await browser.newContext();
    try {
      const staffPage = await deniedStaffContext.newPage();
      await staffPage.goto("/login");
      await staffPage.getByLabel("이메일").fill(staffEmail);
      await staffPage.getByLabel("비밀번호").fill(targetPassword);
      await staffPage.getByRole("button", { name: "로그인" }).click();
      await expect(staffPage).toHaveURL(/\/dashboard/, { timeout: 30_000 });
      const beforeApprovalCount = await db.bootstrapApproval.count();
      const beforeApprovals = await db.bootstrapApproval.findMany({ orderBy: { id: "asc" } });
      const beforeAcceptances = await db.bootstrapAcceptance.findMany({ orderBy: { id: "asc" } });
      const beforeStaff = await db.user.findUniqueOrThrow({ where: { id: staffId } });
      const beforeAcceptance = await db.bootstrapAcceptance.findUniqueOrThrow({ where: { id: acceptance.id } });
      const beforeTarget = await db.user.findUniqueOrThrow({ where: { id: targetId } });
      for (const context of [anonymousContext, deniedStaffContext]) {
        for (const captured of [capturedPrepare, capturedIssue, capturedRevoke, capturedAcceptance, capturedExecute]) {
          const headers = captured.headers();
          const body = captured.postDataBuffer();
          expect(body).not.toBeNull();
          // Change the approval email to another same-length synthetic value so
          // a duplicate-email constraint cannot mask a missing authorization check.
          const freshEmail = targetEmail.replace("p7-", "q7-");
          const data = captured === capturedPrepare ? Buffer.from(body!.toString().replaceAll(targetEmail, freshEmail)) : body!;
          await context.request.post(captured.url(), { data, headers: {
            "next-action": headers["next-action"], "content-type": headers["content-type"],
            origin: new URL(captured.url()).origin, accept: "text/x-component",
          }, maxRedirects: 0 });
        }
      }
      expect(await db.bootstrapApproval.count()).toBe(beforeApprovalCount);
      expect(await db.bootstrapApproval.findMany({ orderBy: { id: "asc" } })).toEqual(beforeApprovals);
      expect(await db.bootstrapAcceptance.findMany({ orderBy: { id: "asc" } })).toEqual(beforeAcceptances);
      expect(await db.user.findUniqueOrThrow({ where: { id: staffId } })).toEqual(beforeStaff);
      expect(await db.bootstrapAcceptance.findUniqueOrThrow({ where: { id: acceptance.id } })).toEqual(beforeAcceptance);
      expect(await db.user.findUniqueOrThrow({ where: { id: targetId } })).toEqual(beforeTarget);
      expect(await db.bootstrapCompletion.count()).toBe(0);
      expect(await db.user.count({ where: { email: targetEmail.replace("p7-", "q7-") } })).toBe(0);
    } finally { await anonymousContext.close(); await deniedStaffContext.close(); }
    await page.goto("/accounts/first-super-admin");
    const execute = page.locator("form").filter({ has: page.getByRole("button", { name: "등록 실행" }) });
    await execute.getByLabel("승인 ID").fill(approvalId);
    await execute.getByLabel("수락 ID").fill(acceptance.id);
    await execute.getByRole("button", { name: "등록 실행" }).click();
    await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { id: targetId } })).role).toBe("SUPER_ADMIN");
    expect(await db.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ isActive: true, mustChangePassword: true, authVersion: 2 });
    expect(await db.bootstrapCompletion.findFirst({ where: { approvalId, acceptanceId: acceptance.id } })).not.toBeNull();
    // Replay while the newly registered SUPER_ADMIN exists.
    const replay = async () => {
      await page.goto("/accounts/first-super-admin");
      const form = page.locator("form").filter({ has: page.getByRole("button", { name: "등록 실행" }) });
      await form.getByLabel("승인 ID").fill(approvalId);
      await form.getByLabel("수락 ID").fill(acceptance.id);
      const response = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/accounts/first-super-admin");
      await form.getByRole("button", { name: "등록 실행" }).click();
      await response;
      expect(await db.bootstrapCompletion.count()).toBe(1);
      expect(await db.userAccountChange.count({ where: { targetUserId: targetId, type: "CREATED" } })).toBe(1);
    };
    await replay();
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("이메일").fill(targetEmail);
    await page.getByLabel("비밀번호").fill(targetPassword);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/account\/password/, { timeout: 30_000 });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/account\/password/);
    await page.getByLabel("현재 비밀번호").fill(targetPassword);
    await page.getByLabel("새 비밀번호", { exact: true }).fill(`new-synthetic-${suffix}`);
    await page.getByLabel("새 비밀번호 확인").fill(`new-synthetic-${suffix}`);
    await page.getByRole("button", { name: "비밀번호 변경" }).click();
    await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { id: targetId } })).mustChangePassword).toBe(false);
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("이메일").fill(targetEmail);
    await page.getByLabel("비밀번호").fill(`new-synthetic-${suffix}`);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    // P5 regression: account changes through the UI invalidate existing sessions.
    const staffContext = await browser.newContext();
    const legacyContext = await browser.newContext();
    try {
      const legacyPage = await legacyContext.newPage();
      await legacyPage.goto("/login");
      await legacyPage.getByLabel("이메일").fill(adminEmail);
      await legacyPage.getByLabel("비밀번호").fill(adminPassword);
      await legacyPage.getByRole("button", { name: "로그인" }).click();
      await expect(legacyPage).toHaveURL(/\/dashboard/, { timeout: 30_000 });
      const staffPage = await staffContext.newPage();
      const staffLogin = async () => {
        await staffPage.goto("/login");
        await staffPage.getByLabel("이메일").fill(staffEmail);
        await staffPage.getByLabel("비밀번호").fill(targetPassword);
        await staffPage.getByRole("button", { name: "로그인" }).click();
        await expect(staffPage).toHaveURL(/\/dashboard/, { timeout: 30_000 });
      };
      await staffLogin();
      await legacyPage.goto(`/accounts/${staffId}/edit`);
      await legacyPage.getByLabel(/역할/).selectOption("MANAGER");
      await legacyPage.getByRole("button", { name: "변경사항 저장" }).click();
      await expect(legacyPage).toHaveURL(new RegExp(`/accounts/${staffId}$`));
      await staffPage.goto("/dashboard");
      await expect(staffPage).toHaveURL(/\/login/);
      await staffLogin();
      await legacyPage.goto(`/accounts/${staffId}/edit`);
      await legacyPage.getByLabel("활성 계정").uncheck();
      await legacyPage.getByRole("button", { name: "변경사항 저장" }).click();
      await expect(legacyPage).toHaveURL(new RegExp(`/accounts/${staffId}$`));
      await staffPage.goto("/dashboard");
      await expect(staffPage).toHaveURL(/\/login/);
    } finally { await staffContext.close(); await legacyContext.close(); }
  } finally {
    // The suite is restricted to a disposable local database by its dedicated config.
    await db.bootstrapCompletion.deleteMany({ where: { approvalId } });
    await db.bootstrapAcceptance.deleteMany({ where: { approvalId } });
    await db.bootstrapApproval.deleteMany({ where: { id: approvalId } });
    await db.userAccountChange.deleteMany({ where: { OR: [{ actorAdminId: adminId }, { targetUserId: targetId }, { targetUserId: staffId }] } });
    await db.user.deleteMany({ where: { id: { in: [adminId, targetId, staffId] } } });
    await db.$disconnect();
  }
});

// The dedicated configuration starts separate local servers with fixed modes,
// fake or OFF delivery, and the same disposable database.
test("P2-S INVALID, P3 invitations and P4 fake / use-gate regressions", async ({ browser }) => {
  test.setTimeout(180_000);
  const superUrl = "http://127.0.0.1:3001", invalidUrl = "http://127.0.0.1:3002", offUrl = "http://127.0.0.1:3003";
  const { PrismaClient } = await import("@prisma/client");
  const { randomBytes, createHash } = await import("node:crypto");
  const db = new PrismaClient();
  const run = `p7-regression-${crypto.randomUUID()}`;
  const password = `${run}-Password1!`, superId = `${run}-super`, adminId = `${run}-admin`;
  const email = (kind: string) => `${run}-${kind}@example.test`;
  const ctx = await browser.newContext();
  try {
    const hashed = await hash(password, 12);
    await db.user.createMany({ data: [
      { id: superId, name: "Synthetic Super", email: email("super"), password: hashed, role: "SUPER_ADMIN" },
      { id: adminId, name: "Synthetic Admin", email: email("admin"), password: hashed, role: "ADMIN" },
    ] });
    const page = await ctx.newPage();
    const login = async (base: string, address: string) => {
      await ctx.clearCookies();
      await page.goto(`${base}/login`);
      await page.getByLabel("이메일").fill(address);
      await page.getByLabel("비밀번호").fill(password);
      await page.getByRole("button", { name: "로그인" }).click();
      await expect(page).toHaveURL(/\/dashboard/);
    };
    await login(invalidUrl, email("admin"));
    const invalid = await page.goto(`${invalidUrl}/accounts`);
    if (invalid?.status() !== 404) await expect(page.locator("body")).toContainText(/404|This page could not be found/i);

    await login(superUrl, email("super"));
    await page.goto(`${superUrl}/invitations`);
    const roles = page.getByLabel(/역할/);
    expect(await roles.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).not.toContain("SUPER_ADMIN");
    await page.getByLabel("이름 *", { exact: true }).fill("Synthetic Invite");
    await page.getByLabel(/이메일/).fill(email("issued"));
    await roles.selectOption("STAFF");
    const issueRequest = page.waitForRequest(r => r.method() === "POST" && Boolean(r.headers()["next-action"]));
    await page.getByRole("button", { name: "초대 발급" }).click();
    const capturedIssue = await issueRequest;
    await expect(page.locator("body")).toContainText("발송 요청 접수");
    const capturedBody = capturedIssue.postDataBuffer();
    expect(capturedBody).not.toBeNull();
    const original = capturedBody!.toString();
    expect(original).toContain("STAFF");
    expect(original).toContain(email("issued"));
    const forged = original.replaceAll(email("issued"), email("denied")).replace("STAFF", "SUPER_ADMIN");
    const issueHeaders = capturedIssue.headers();
    await ctx.request.post(capturedIssue.url(), { data: Buffer.from(forged), headers: {
      "next-action": issueHeaders["next-action"], "content-type": issueHeaders["content-type"],
      origin: superUrl, accept: "text/x-component",
    }, maxRedirects: 0 });
    expect(await db.adminInvitation.count({ where: { email: email("denied") } })).toBe(0);
    expect(await db.user.count({ where: { email: email("denied") } })).toBe(0);
    const issued = await db.adminInvitation.findFirstOrThrow({ where: { email: email("issued") } });
    expect((await db.invitationDeliveryAttempt.findUniqueOrThrow({ where: { invitationId: issued.id } })).status).toBe("ACCEPTED");
    // The fake adapter does not expose its token. Replace only this isolated
    // invitation's hash with a synthetic capability and accept that issuance.
    const token = randomBytes(32).toString("base64url"), targetId = issued.targetUserId;
    await db.adminInvitation.update({ where: { id: issued.id }, data: { tokenHash: createHash("sha256").update(token).digest("hex") } });
    const invitation = issued;
    await page.goto(`${offUrl}/invite/${token}`);
    await expect(page.locator("body")).toContainText("유효하지 않은 초대 링크입니다");
    await expect(page.getByRole("button", { name: "비밀번호 설정하고 계정 활성화" })).toHaveCount(0);
    expect((await db.adminInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).usedAt).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: targetId } })).isActive).toBe(false);
    await page.goto(`${superUrl}/invite/${token}`);
    await page.getByLabel("새 비밀번호 *", { exact: true }).fill(password);
    await page.getByLabel("새 비밀번호 확인 *", { exact: true }).fill(password);
    await page.getByRole("button", { name: "비밀번호 설정하고 계정 활성화" }).click();
    await expect(page.locator("body")).toContainText("초대를 수락했습니다");
    expect((await db.adminInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).usedAt).not.toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: targetId } })).isActive).toBe(true);
  } finally {
    const users = await db.user.findMany({ where: { email: { startsWith: run } }, select: { id: true } });
    const ids = users.map(u => u.id);
    await db.invitationDeliveryAttempt.deleteMany({ where: { invitation: { issuedById: superId } } });
    await db.adminInvitation.deleteMany({ where: { issuedById: superId } });
    await db.userAccountChange.deleteMany({ where: { OR: [{ targetUserId: { in: ids } }, { actorAdminId: { in: ids } }] } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await ctx.close();
    await db.$disconnect();
  }
});

test("completion singleton blocks a new registration even with zero SUPER_ADMIN users", async ({ page }) => {
  test.setTimeout(120_000);
  const { PrismaClient } = await import("@prisma/client");
  const { createHash, randomBytes } = await import("node:crypto");
  const db = new PrismaClient();
  const adminId = process.env.YAHO_P7_APPROVER_USER_ID;
  if (!adminId || !/^p7-e2e-[a-z0-9-]+$/.test(adminId)) throw new Error("P7_SYNTHETIC_APPROVER_REQUIRED");
  const run = `p7-zero-${crypto.randomUUID()}`;
  const targetId = `${run}-target`, oldTargetId = `${run}-old`, password = `${run}-Password1!`;
  let oldApprovalId = "", oldAcceptanceId = "", approvalId = "", acceptanceId = "";
  let usersCreated = false;
  try {
    expect(await db.bootstrapCompletion.count()).toBe(0);
    expect(await db.user.count({ where: { role: "SUPER_ADMIN" } })).toBe(0);
    await db.user.createMany({ data: [
      { id: adminId, name: "Synthetic Admin", email: `${adminId}@example.test`, role: "ADMIN", password: await hash(password, 12) },
      { id: targetId, name: "Synthetic Target", email: `${targetId}@example.test`, role: "STAFF", isActive: false, password: await hash(password, 12), mustChangePassword: true },
      { id: oldTargetId, name: "Synthetic Former Super", email: `${oldTargetId}@example.test`, role: "STAFF", isActive: false },
    ] });
    usersCreated = true;
    const now = new Date(), expiresAt = new Date(now.getTime() + 3_600_000);
    const oldApproval = await db.bootstrapApproval.create({ data: { approverUserId: adminId, targetUserId: oldTargetId, targetEmail: `${oldTargetId}@example.test`, approvedAt: now, expiresAt, identityMethod: "FACE_TO_FACE", identityAt: now, consumedAt: now, executionId: "FIRST_SUPER_ADMIN" } });
    oldApprovalId = oldApproval.id;
    const oldAcceptance = await db.bootstrapAcceptance.create({ data: { approvalId: oldApproval.id, acceptedForUserId: oldTargetId, targetEmail: `${oldTargetId}@example.test`, tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"), expiresAt, acceptedAt: now, tokenVerified: true, authenticationMethod: "TOKEN_POSSESSION", consumedAt: now, executionId: "FIRST_SUPER_ADMIN" } });
    oldAcceptanceId = oldAcceptance.id;
    await db.bootstrapCompletion.create({ data: { id: "FIRST_SUPER_ADMIN", approvalId: oldApprovalId, acceptanceId: oldAcceptanceId, completedAt: now } });
    const approval = await db.bootstrapApproval.create({ data: { approverUserId: adminId, targetUserId: targetId, targetEmail: `${targetId}@example.test`, approvedAt: now, expiresAt, identityMethod: "FACE_TO_FACE", identityAt: now } });
    approvalId = approval.id;
    const acceptance = await db.bootstrapAcceptance.create({ data: { approvalId, acceptedForUserId: targetId, targetEmail: `${targetId}@example.test`, tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"), expiresAt, acceptedAt: now, tokenVerified: true, authenticationMethod: "TOKEN_POSSESSION" } });
    acceptanceId = acceptance.id;
    await page.goto("/login");
    await page.getByLabel("이메일").fill(`${adminId}@example.test`);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/accounts/first-super-admin");
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "등록 실행" }) });
    await form.getByLabel("승인 ID").fill(approvalId);
    await form.getByLabel("수락 ID").fill(acceptanceId);
    const response = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/accounts/first-super-admin");
    await form.getByRole("button", { name: "등록 실행" }).click();
    await response;
    expect(await db.user.count({ where: { role: "SUPER_ADMIN" } })).toBe(0);
    expect(await db.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ role: "STAFF", isActive: false });
    expect((await db.bootstrapApproval.findUniqueOrThrow({ where: { id: approvalId } })).consumedAt).toBeNull();
    expect((await db.bootstrapAcceptance.findUniqueOrThrow({ where: { id: acceptanceId } })).consumedAt).toBeNull();
    expect(await db.bootstrapCompletion.count()).toBe(1);
    expect(await db.userAccountChange.count({ where: { targetUserId: targetId } })).toBe(0);
  } finally {
    await db.bootstrapCompletion.deleteMany({ where: { approvalId: oldApprovalId } });
    await db.bootstrapAcceptance.deleteMany({ where: { id: { in: [oldAcceptanceId, acceptanceId] } } });
    await db.bootstrapApproval.deleteMany({ where: { id: { in: [oldApprovalId, approvalId] } } });
    if (usersCreated) await db.user.deleteMany({ where: { id: { in: [adminId, targetId, oldTargetId] } } });
    await db.$disconnect();
  }
});

// User decision: "수락자는 로그인 불가, 일회용 토큰으로 수락, 대면 확인 별도 필수".
// Acceptance is a target-bound capability; a session does not receive the grant.
for (const session of ["anonymous", "staff"] as const) {
  test(`unused valid acceptance token succeeds for direct ${session} POST only for the designated target`, async ({ page, browser }) => {
    test.setTimeout(120_000);
    const { PrismaClient } = await import("@prisma/client");
    const { createHash, randomBytes } = await import("node:crypto");
    const db = new PrismaClient();
    const approverId = process.env.YAHO_P7_APPROVER_USER_ID;
    if (!approverId || !/^p7-e2e-[a-z0-9-]+$/.test(approverId)) throw new Error("P7_SYNTHETIC_APPROVER_REQUIRED");
    const run = `p7-direct-${crypto.randomUUID()}`, targetId = `${run}-target`, staffId = `${run}-staff`;
    const password = `${run}-Password1!`, token = randomBytes(32).toString("base64url");
    const context = await browser.newContext();
    let approvalId = "", acceptanceId = "", usersCreated = false;
    try {
      expect(await db.bootstrapCompletion.count()).toBe(0);
      expect(await db.user.count({ where: { role: "SUPER_ADMIN" } })).toBe(0);
      await db.user.createMany({ data: [
        { id: approverId, name: "Synthetic Approver", email: `${approverId}@example.test`, role: "ADMIN" },
        { id: targetId, name: "Synthetic Target", email: `${targetId}@example.test`, role: "STAFF", isActive: false },
        { id: staffId, name: "Synthetic Staff", email: `${staffId}@example.test`, role: "STAFF", password: await hash(password, 12) },
      ] });
      usersCreated = true;
      const now = new Date(), expiresAt = new Date(now.getTime() + 3_600_000);
      const approval = await db.bootstrapApproval.create({ data: { approverUserId: approverId, targetUserId: targetId, targetEmail: `${targetId}@example.test`, approvedAt: now, expiresAt, identityMethod: "FACE_TO_FACE", identityAt: now } });
      approvalId = approval.id;
      const acceptance = await db.bootstrapAcceptance.create({ data: { approvalId, acceptedForUserId: targetId, targetEmail: `${targetId}@example.test`, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt } });
      acceptanceId = acceptance.id;
      if (session === "staff") {
        const staffPage = await context.newPage();
        await staffPage.goto("/login");
        await staffPage.getByLabel("이메일").fill(`${staffId}@example.test`);
        await staffPage.getByLabel("비밀번호").fill(password);
        await staffPage.getByRole("button", { name: "로그인" }).click();
        await expect(staffPage).toHaveURL(/\/dashboard/);
      }
      // Capture the actual bound Server Action without letting this browser
      // submit it; replay its exact body with the session being tested.
      await page.goto(`/first-super-admin/${token}`);
      await page.getByLabel("비밀번호", { exact: true }).fill(password);
      await page.getByLabel("비밀번호 확인").fill(password);
      await page.route("**/first-super-admin/**", route => route.request().method() === "POST" ? route.abort() : route.continue());
      const actionRequest = page.waitForRequest(r => r.method() === "POST" && Boolean(r.headers()["next-action"]));
      await page.getByRole("button", { name: "수락" }).click().catch(() => {});
      const captured = await actionRequest;
      await page.unroute("**/first-super-admin/**");
      const body = captured.postDataBuffer(), headers = captured.headers();
      expect(body).not.toBeNull();
      const post = () => context.request.post(captured.url(), { data: body!, headers: {
        "next-action": headers["next-action"], "content-type": headers["content-type"],
        origin: new URL(captured.url()).origin, accept: "text/x-component",
      }, maxRedirects: 0 });
      const beforeTarget = await db.user.findUniqueOrThrow({ where: { id: targetId } });
      const beforeStaff = await db.user.findUniqueOrThrow({ where: { id: staffId } });
      const originalAcceptance = await db.bootstrapAcceptance.findUniqueOrThrow({ where: { id: acceptanceId } });
      // Keep the same bound action and change only the relevant stored evidence.
      // This exercises unknown, expired and incorrectly bound capabilities.
      for (const change of [
        { tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex") },
        { expiresAt: new Date(0) },
        { acceptedForUserId: staffId, targetEmail: `${staffId}@example.test` },
      ]) {
        await db.bootstrapAcceptance.update({ where: { id: acceptanceId }, data: change });
        const before = await db.bootstrapAcceptance.findUniqueOrThrow({ where: { id: acceptanceId } });
        await post();
        expect(await db.bootstrapAcceptance.findUniqueOrThrow({ where: { id: acceptanceId } })).toEqual(before);
        expect(await db.user.findUniqueOrThrow({ where: { id: targetId } })).toEqual(beforeTarget);
        expect(await db.user.findUniqueOrThrow({ where: { id: staffId } })).toEqual(beforeStaff);
        await db.bootstrapAcceptance.update({ where: { id: acceptanceId }, data: {
          tokenHash: originalAcceptance.tokenHash, expiresAt: originalAcceptance.expiresAt,
          acceptedForUserId: targetId, targetEmail: originalAcceptance.targetEmail,
        } });
      }
      await post();
      const accepted = await db.bootstrapAcceptance.findUniqueOrThrow({ where: { id: acceptanceId } });
      expect(accepted).toMatchObject({ approvalId, acceptedForUserId: targetId, targetEmail: originalAcceptance.targetEmail, tokenVerified: true, authenticationMethod: "TOKEN_POSSESSION", revokedAt: null, consumedAt: null });
      expect(accepted.acceptedAt).not.toBeNull();
      const target = await db.user.findUniqueOrThrow({ where: { id: targetId } });
      expect(target).toMatchObject({ role: "STAFF", isActive: false, authVersion: 1, mustChangePassword: true });
      expect(target.password).toMatch(/^\$2[aby]\$12\$/);
      expect(await compare(password, target.password!)).toBe(true);
      expect(await db.user.findUniqueOrThrow({ where: { id: staffId } })).toEqual(beforeStaff);
      expect(await db.bootstrapCompletion.count()).toBe(0);
      expect(await db.userAccountChange.count({ where: { targetUserId: { in: [targetId, staffId] } } })).toBe(0);
      // Reuse must leave the accepted evidence and both accounts unchanged.
      await post();
      expect(await db.bootstrapAcceptance.findUniqueOrThrow({ where: { id: acceptanceId } })).toEqual(accepted);
      expect(await db.user.findUniqueOrThrow({ where: { id: targetId } })).toEqual(target);
      expect(await db.user.findUniqueOrThrow({ where: { id: staffId } })).toEqual(beforeStaff);
      expect(await db.bootstrapCompletion.count()).toBe(0);
    } finally {
      await context.close();
      await db.bootstrapAcceptance.deleteMany({ where: { id: acceptanceId } });
      await db.bootstrapApproval.deleteMany({ where: { id: approvalId } });
      if (usersCreated) await db.user.deleteMany({ where: { id: { in: [approverId, targetId, staffId] } } });
      await db.$disconnect();
    }
  });
}
