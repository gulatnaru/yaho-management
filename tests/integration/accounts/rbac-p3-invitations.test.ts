/**
 * P3 직원 초대 — 격리 PostgreSQL 16에서 실제 DB 토큰·활성화·감사 계약을 검증한다.
 *
 * 실행 환경: 독립 임시 PG16 (127.0.0.1:55432, DB/user yaho_e2e, DB 안전 게이트 통과 URL),
 * 기존 migration 15건 + P1 draft + P3 draft 적용 상태. 실제 프로젝트 DB(Preview/Production)에는
 * 절대 접속하지 않는다. 합성 관리자·직원·선생님 행만 사용한다.
 *
 * 검증 경계 (정직한 표기):
 * - 실제: 초대 코어(발급·재발급·해지·수락), 감사 원자성, 토큰 해시 저장, 조건부
 *   업데이트 동시성, 모드별 발급·수락 차단, credential 로그인 가능 상태
 *   (authenticateOperator + 실제 bcrypt 해시), 관리자 액션 배선.
 * - 스텁된 부분: 초대 사용 게이트는 승인된 상태, 발송은 ACCEPTED로 mock하고, 세션 전송 계층을 mock한다
 *   (`@/auth`의 auth()가 합성 세션을 반환하고 실제 resolveSessionPrincipal이 격리 DB 행을
 *   읽어 principal을 만든다). HTTP 요청 전송
 *   계층은 검증하지 않는다 — HTTP/E2E 배선은 tests/e2e/p3-invitation.spec.ts에서 검증한다.
 * - 테스트 간 순서 의존: describe.sequential이며, 각 테스트는 run별 고유 이메일로 독립 검증한다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

const sessionHolder = vi.hoisted(() => ({ userId: "", authVersion: 1 }));
const actionContext = vi.hoisted(() => ({ db: null as unknown as PrismaClient }));

vi.mock("@/lib/invitations/config", () => ({ invitationUseEnabled: () => true }));
vi.mock("@/server/accounts/invitation-delivery", () => ({ deliverIssuedInvitation: async () => "ACCEPTED" }));
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: sessionHolder.userId, authVersion: sessionHolder.authVersion },
  })),
}));
vi.mock("@/lib/db/prisma", () => ({
  get prisma() {
    return actionContext.db;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  },
}));

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") {
  throw new Error("UX_INTEGRATION_LOCAL_ONLY");
}
assertSafeE2eDatabaseUrls({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
});

const db = new PrismaClient();
actionContext.db = db;

const CUTOVER_ENV = "YAHO_ADMIN_CUTOVER_MODE";
const originalCutoverMode = process.env[CUTOVER_ENV];

const run = `p3int-${crypto.randomUUID()}`;
const superId = `${run}-super`;
const adminId = `${run}-admin`;
const teacherDbId = `${run}-teacher`;
const createdUserIds: string[] = [];
const createdInvitationIds: string[] = [];

function setMode(mode: string) {
  process.env[CUTOVER_ENV] = mode;
}

function superPrincipal() {
  return { userId: superId, name: "합성 최고관리자", email: `${run}-super@example.test`, role: "SUPER_ADMIN", teacherId: null } as never;
}

function adminPrincipal() {
  return { userId: adminId, name: "합성 관리자", email: `${run}-admin@example.test`, role: "ADMIN", teacherId: null } as never;
}

async function freshInvitations() {
  vi.resetModules();
  return import("@/server/accounts/invitations");
}

async function freshInvitationActions() {
  vi.resetModules();
  return import("@/app/(admin)/invitations/actions");
}

async function freshCredentials() {
  vi.resetModules();
  return import("@/lib/auth/credentials");
}

function accountForm(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

async function cleanup() {
  // 재발급은 새 행을 만들므로 id 목록만으로는 부족하다 — 발급자·대상 기준으로도 정리한다
  // (범위는 이 run의 합성 id로 한정된다).
  await db.adminInvitation.deleteMany({
    where: { OR: [{ id: { in: createdInvitationIds } }, { issuedById: { in: createdUserIds } }, { targetUserId: { in: createdUserIds } }] },
  });
  await db.userAccountChange.deleteMany({ where: { targetUserId: { in: createdUserIds } } });
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
}

beforeAll(async () => {
  setMode("SUPER_ADMIN");
  await db.user.create({
    data: { id: superId, name: "합성 최고관리자", email: `${run}-super@example.test`, role: "SUPER_ADMIN", isActive: true, mustChangePassword: false },
  });
  await db.user.create({
    data: { id: adminId, name: "합성 관리자", email: `${run}-admin@example.test`, role: "ADMIN", isActive: true, mustChangePassword: false },
  });
  await db.teacher.create({ data: { id: teacherDbId, name: "합성 선생님", isActive: true } });
  createdUserIds.push(superId, adminId);
});

afterAll(async () => {
  await cleanup();
  await db.teacher.deleteMany({ where: { id: teacherDbId } });
  await db.$disconnect();
  if (originalCutoverMode === undefined) delete process.env[CUTOVER_ENV];
  else process.env[CUTOVER_ENV] = originalCutoverMode;
});

describe.sequential("P3 초대 — 격리 PG 통합", () => {
  it("발급→수락→로그인 가능: 해시 저장·활성화·감사·authVersion 증가가 실제 DB에서 확인된다", async () => {
    const { issueInvitationCore, acceptInvitationCore } = await freshInvitations();
    const { authenticateOperator } = await freshCredentials();
    const email = `${run}-staff1@example.test`;
    const password = "P3-accept-1!";
    const issued = await issueInvitationCore(superPrincipal(), { name: "직원1", email, role: "STAFF", teacherId: null }, db as never);
    createdInvitationIds.push(issued.invitationId);
    createdUserIds.push(issued.targetUserId);

    const invitationRow = await db.adminInvitation.findUniqueOrThrow({ where: { id: issued.invitationId } });
    expect(invitationRow.tokenHash).not.toBe(issued.token);
    expect(invitationRow.tokenHash).toHaveLength(64);
    expect(invitationRow.expiresAt.getTime() - Date.now()).toBeGreaterThan(71 * 60 * 60 * 1000);
    const beforeUser = await db.user.findUniqueOrThrow({ where: { id: issued.targetUserId } });
    expect(beforeUser.isActive).toBe(false);
    expect(beforeUser.password).toBeNull();
    // 수락 전 로그인은 차단된다.
    expect(await authenticateOperator({ email, password }, db as never)).toBeNull();

    const accepted = await acceptInvitationCore({ token: issued.token, passwordHash: await hash(password, 12) }, db as never);
    expect(accepted.userId).toBe(issued.targetUserId);
    const afterUser = await db.user.findUniqueOrThrow({ where: { id: issued.targetUserId } });
    expect(afterUser.isActive).toBe(true);
    expect(afterUser.mustChangePassword).toBe(false);
    expect(afterUser.authVersion).toBe(beforeUser.authVersion + 1);
    const afterInvitation = await db.adminInvitation.findUniqueOrThrow({ where: { id: issued.invitationId } });
    expect(afterInvitation.usedAt).toBeInstanceOf(Date);
    const audits = await db.userAccountChange.findMany({ where: { targetUserId: issued.targetUserId, type: "INVITATION_ACCEPTED" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorAdminId).toBe(issued.targetUserId);
    expect(audits[0].previousIsActive).toBe(false);
    expect(audits[0].nextIsActive).toBe(true);
    // 수락 후 실제 credential 로그인이 가능해진다.
    const login = await authenticateOperator({ email, password }, db as never);
    expect(login?.id).toBe(issued.targetUserId);

    // 재사용은 거부되고 DB 상태는 변하지 않는다.
    await expect(acceptInvitationCore({ token: issued.token, passwordHash: await hash(password, 12) }, db as never)).rejects.toMatchObject({
      code: "INVITATION_ALREADY_USED",
    });
    const auditsAfter = await db.userAccountChange.findMany({ where: { targetUserId: issued.targetUserId, type: "INVITATION_ACCEPTED" } });
    expect(auditsAfter).toHaveLength(1);
  });

  it("동시 수락 5건 중 정확히 1건만 성공한다", async () => {
    const { issueInvitationCore, acceptInvitationCore } = await freshInvitations();
    const email = `${run}-staff2@example.test`;
    const password = "P3-accept-2!";
    const issued = await issueInvitationCore(superPrincipal(), { name: "직원2", email, role: "STAFF", teacherId: null }, db as never);
    createdInvitationIds.push(issued.invitationId);
    createdUserIds.push(issued.targetUserId);
    const passwordHash = await hash(password, 12);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => acceptInvitationCore({ token: issued.token, passwordHash }, db as never)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(4);
    for (const r of rejected) expect((r.reason as { code: string }).code).toBe("INVITATION_ALREADY_USED");
    const audits = await db.userAccountChange.findMany({ where: { targetUserId: issued.targetUserId, type: "INVITATION_ACCEPTED" } });
    expect(audits).toHaveLength(1);
  });

  it("재발급: 기존 토큰 무효 + 새 토큰 유효 + 계정 역할·활성 불변 + REVOKED·RESENT 감사", async () => {
    const { issueInvitationCore, reissueInvitationCore, acceptInvitationCore } = await freshInvitations();
    const email = `${run}-staff3@example.test`;
    const issued = await issueInvitationCore(superPrincipal(), { name: "직원3", email, role: "MANAGER", teacherId: null }, db as never);
    createdInvitationIds.push(issued.invitationId);
    createdUserIds.push(issued.targetUserId);
    const beforeUser = await db.user.findUniqueOrThrow({ where: { id: issued.targetUserId } });
    const reissued = await reissueInvitationCore(superPrincipal(), issued.invitationId, db as never);
    createdInvitationIds.push(reissued.invitationId);
    expect(reissued.targetUserId).toBe(issued.targetUserId);
    expect(reissued.token).not.toBe(issued.token);
    const midUser = await db.user.findUniqueOrThrow({ where: { id: issued.targetUserId } });
    expect(midUser.role).toBe(beforeUser.role);
    expect(midUser.isActive).toBe(false);
    const types = (await db.userAccountChange.findMany({ where: { targetUserId: issued.targetUserId } })).map((row) => row.type);
    expect(types).toContain("INVITATION_REVOKED");
    expect(types).toContain("INVITATION_RESENT");
    // 재발급은 기존 행을 삭제하지 않고 해지하므로, 기존 토큰은 해지됨으로 거부된다
    // (행이 남아 있어도 수락은 불가하고, 새 토큰만 유효하다).
    await expect(acceptInvitationCore({ token: issued.token, passwordHash: "x" }, db as never)).rejects.toMatchObject({
      code: "INVITATION_REVOKED",
    });
    const accepted = await acceptInvitationCore({ token: reissued.token, passwordHash: await hash("P3-accept-3!", 12) }, db as never);
    expect(accepted.userId).toBe(issued.targetUserId);
  });

  it("해지·만료·변조 토큰은 수락이 거부되고 계정·감사가 불변이다", async () => {
    const { issueInvitationCore, cancelInvitationCore, acceptInvitationCore } = await freshInvitations();
    // 해지
    const cancelled = await issueInvitationCore(superPrincipal(), { name: "직원4", email: `${run}-staff4@example.test`, role: "STAFF", teacherId: null }, db as never);
    createdInvitationIds.push(cancelled.invitationId);
    createdUserIds.push(cancelled.targetUserId);
    await cancelInvitationCore(superPrincipal(), cancelled.invitationId, db as never);
    await expect(acceptInvitationCore({ token: cancelled.token, passwordHash: "x" }, db as never)).rejects.toMatchObject({
      code: "INVITATION_REVOKED",
    });
    // 만료
    const expired = await issueInvitationCore(superPrincipal(), { name: "직원5", email: `${run}-staff5@example.test`, role: "STAFF", teacherId: null }, db as never);
    createdInvitationIds.push(expired.invitationId);
    createdUserIds.push(expired.targetUserId);
    await db.adminInvitation.update({ where: { id: expired.invitationId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptInvitationCore({ token: expired.token, passwordHash: "x" }, db as never)).rejects.toMatchObject({
      code: "INVITATION_EXPIRED",
    });
    // 변조 (형식은 맞지만 해시 불일치)
    const tampered = await issueInvitationCore(superPrincipal(), { name: "직원6", email: `${run}-staff6@example.test`, role: "STAFF", teacherId: null }, db as never);
    createdInvitationIds.push(tampered.invitationId);
    createdUserIds.push(tampered.targetUserId);
    const tamperedToken = `${tampered.token.slice(0, -2)}zz`;
    await expect(acceptInvitationCore({ token: tamperedToken, passwordHash: "x" }, db as never)).rejects.toMatchObject({
      code: "INVITATION_INVALID",
    });
    for (const target of [cancelled, expired, tampered]) {
      const user = await db.user.findUniqueOrThrow({ where: { id: target.targetUserId } });
      expect(user.isActive).toBe(false);
      expect(user.password).toBeNull();
      const accepted = await db.userAccountChange.findMany({ where: { targetUserId: target.targetUserId, type: "INVITATION_ACCEPTED" } });
      expect(accepted).toHaveLength(0);
    }
  });

  it("모드 매트릭스: LEGACY+SUPER_ADMIN 발급 허용, LEGACY+ADMIN 거부, INVALID+SUPER_ADMIN 발급·수락 차단", async () => {
    const { issueInvitationCore, acceptInvitationCore } = await freshInvitations();
    setMode("LEGACY_ADMIN");
    const legacyOk = await issueInvitationCore(superPrincipal(), { name: "직원7", email: `${run}-staff7@example.test`, role: "STAFF", teacherId: null }, db as never);
    createdInvitationIds.push(legacyOk.invitationId);
    createdUserIds.push(legacyOk.targetUserId);
    await expect(
      issueInvitationCore(adminPrincipal(), { name: "x", email: `${run}-staff7b@example.test`, role: "STAFF", teacherId: null }, db as never),
    ).rejects.toMatchObject({ code: "INVITATION_FORBIDDEN" });
    setMode("BOGUS_MODE");
    await expect(
      issueInvitationCore(superPrincipal(), { name: "x", email: `${run}-staff7c@example.test`, role: "STAFF", teacherId: null }, db as never),
    ).rejects.toMatchObject({ code: "INVITATION_MODE_INVALID" });
    await expect(acceptInvitationCore({ token: legacyOk.token, passwordHash: "x" }, db as never)).rejects.toMatchObject({
      code: "INVITATION_INVALID",
    });
    setMode("SUPER_ADMIN");
  });

  it("일반 초대 경로의 SUPER_ADMIN 지정·활성 이메일 초대·역할 불일치 재초대는 거부된다", async () => {
    const { issueInvitationCore } = await freshInvitations();
    await expect(
      issueInvitationCore(superPrincipal(), { name: "x", email: `${run}-super-x@example.test`, role: "SUPER_ADMIN", teacherId: null } as never, db as never),
    ).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
    expect(await db.user.findUnique({ where: { email: `${run}-super-x@example.test` } })).toBeNull();
    await expect(
      issueInvitationCore(superPrincipal(), { name: "x", email: `${run}-super@example.test`, role: "STAFF", teacherId: null }, db as never),
    ).rejects.toMatchObject({ code: "INVITATION_EMAIL_ACTIVE" });
    const inactive = await issueInvitationCore(superPrincipal(), { name: "직원8", email: `${run}-staff8@example.test`, role: "STAFF", teacherId: null }, db as never);
    createdInvitationIds.push(inactive.invitationId);
    createdUserIds.push(inactive.targetUserId);
    await expect(
      issueInvitationCore(superPrincipal(), { name: "직원8", email: `${run}-staff8@example.test`, role: "MANAGER", teacherId: null }, db as never),
    ).rejects.toMatchObject({ code: "INVITATION_ROLE_MISMATCH" });
  });

  it("TEACHER 초대: 선생님 연결이 유지된 채 수락·로그인 가능하고, 미선택은 거부된다", async () => {
    const { issueInvitationCore, acceptInvitationCore } = await freshInvitations();
    const { authenticateOperator } = await freshCredentials();
    await expect(
      issueInvitationCore(superPrincipal(), { name: "선생님1", email: `${run}-teacher1@example.test`, role: "TEACHER", teacherId: null }, db as never),
    ).rejects.toMatchObject({ code: "TEACHER_REQUIRED" });
    const email = `${run}-teacher2@example.test`;
    const password = "P3-teacher-2!";
    const issued = await issueInvitationCore(superPrincipal(), { name: "선생님2", email, role: "TEACHER", teacherId: teacherDbId }, db as never);
    createdInvitationIds.push(issued.invitationId);
    createdUserIds.push(issued.targetUserId);
    await acceptInvitationCore({ token: issued.token, passwordHash: await hash(password, 12) }, db as never);
    const user = await db.user.findUniqueOrThrow({ where: { id: issued.targetUserId } });
    expect(user.teacherId).toBe(teacherDbId);
    expect(user.isActive).toBe(true);
    expect((await authenticateOperator({ email, password }, db as never))?.id).toBe(issued.targetUserId);
  });

  it("관리자 액션 배선: SUPER_ADMIN 발급은 토큰 없이 성공하고, ADMIN 발급은 404 가드로 차단된다", async () => {
    const actions = await freshInvitationActions();
    sessionHolder.userId = superId;
    sessionHolder.authVersion = 1;
    const email = `${run}-staff9@example.test`;
    const result = await actions.issueInvitation(
      {},
      accountForm({ name: "직원9", email, role: "STAFF" }),
    );
    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).not.toContain("token");
    const row = await db.adminInvitation.findFirstOrThrow({ where: { email } });
    createdInvitationIds.push(row.id);
    const target = await db.user.findUniqueOrThrow({ where: { email } });
    createdUserIds.push(target.id);
    expect(target.isActive).toBe(false);

    sessionHolder.userId = adminId;
    await expect(
      actions.issueInvitation({}, accountForm({ name: "직원10", email: `${run}-staff10@example.test`, role: "STAFF" })),
    ).rejects.toThrow("NOT_FOUND");
    expect(await db.user.findUnique({ where: { email: `${run}-staff10@example.test` } })).toBeNull();
    sessionHolder.userId = superId;
  });
});
