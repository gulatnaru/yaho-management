/**
 * 단순화 결정(ADR-071) — ADMIN 직접 계정 관리 계약을 격리 PostgreSQL 16에서 검증한다.
 *
 * P1의 rbac-p1-bypass.test.ts를 대체한다. P1 파일은 ADMIN 행위자의 일반 계정 생성을
 * 허용 전제로 검증했으나, P2 전환 계약에서는 ADMIN의 계정 관리 자체가 차단되므로
 * 해당 전제가 뒤집혔다. P1 파일은 삭제하고 이 파일이 P2 계약을 검증한다.
 * ADR-071 이후 ADMIN의 계정 관리는 다시 허용되며, SUPER_ADMIN 생성·승격·재설정도
 * 일반 경로로 허용되고, 유일한 차단은 최종 관리 가능 계정 가드(LAST_ACTIVE_MANAGER)이다.
 *
 * 실행 환경: 독립 임시 PG16 (127.0.0.1:55432, DB/user yaho_e2e, DB 안전 게이트 통과 URL),
 * 기존 migration 15건 적용 + P1 draft migration 적용 상태. 실제 프로젝트 DB(Preview/Production)에는
 * 절대 접속하지 않는다. 합성 관리자 및 테스트 데이터만 사용한다.
 *
 * 검증 경계 (정직한 표기):
 * - 실제: 서버 가드(모드 무관 requireAccountManagementPrincipal / requireAdminPrincipal /
 *   requireAdminOrSuperAdminPrincipal / requireOperationalPrincipal), 계정 코어
 *   (ADR-071: 이 파일은 SUPER_ADMIN 모드에서 실행한다 — beforeAll에서 환경변수를
 *   SUPER_ADMIN으로 설정하고 afterAll에서 복원한다. 모드는 판정하지 않으므로
 *   LEGACY·INVALID 모드에서도 동일하게 동작한다 — rbac-p2safe-cutover.test.ts에서 검증한다.)
 *   (create/update/resetAccountCore), 계정 쿼리(listAccounts/getAccountDetail/
 *   listAvailableAccountTeachers/listOwnAccountHistory), 실제 DB 쓰기 결과,
 *   거부 시 DB 행·권한·감사 상태 불변, live principal 반영·authVersion 무효화.
 * - 스텁된 부분: 세션 전송 계층만 mock한다 (`@/auth`의 auth()가 합성 세션을 반환하고,
 *   실제 resolveSessionPrincipal이 격리 DB 행을 읽어 principal을 만든다). HTTP 요청 전송 계층은
 *   검증하지 않는다 — 계정 액션은 HTTP 라우트 표면이 아니라 서버 액션이라, 이 파일의 호출은
 *   HTTP 배선을 입증하지 않는다. 따라서 HTTP 배선 검증은 PASS가 아니라 NOT VERIFIED로 기록한다.
 * - LAST_ACTIVE_MANAGER는 합산 가드이다. 관리자가 여러 명일 때 강등이 허용됨은
 *   이 파일에서 실제 DB로 검증하고, 카운트가 정확히 1명일 때의 거부는 공유 격리 DB를
 *   1명으로 줄일 수 없어(다른 파일의 픽스처도 같은 DB에 존재) 목 기반 단위 테스트에서
 *   판정 순서·코드를 검증한다.
 * - 테스트 간 순서 의존: 세션 무효화 테스트는 SUPER_ADMIN 관리 테스트에서 admin2의
 *   역할 변경·재설정이 먼저 수행됐음을 전제로 한다 (describe.sequential).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

const sessionHolder = vi.hoisted(() => ({ userId: "", authVersion: 1 }));
const actionContext = vi.hoisted(() => ({ db: null as unknown as PrismaClient }));

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

// Defense in depth in addition to vitest.integration.config.ts. No remote fixture/cleanup is possible.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") {
  throw new Error("UX_INTEGRATION_LOCAL_ONLY");
}
assertSafeE2eDatabaseUrls({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
});

const db = new PrismaClient();
actionContext.db = db;

// P2-S: 이 파일의 P2 계약은 SUPER_ADMIN 모드 전제이다. 파일 실행 중 모드를
// 고정하고, 종료 시 원래 값으로 복원한다 (다른 통합 파일과 환경변수 공유 방지).
const CUTOVER_ENV = "YAHO_ADMIN_CUTOVER_MODE";
const originalCutoverMode = process.env[CUTOVER_ENV];

const run = `p2int-${crypto.randomUUID()}`;
const superId = `${run}-super`;
const super2Id = `${run}-super2`;
const adminId = `${run}-admin`;
const admin2Id = `${run}-admin2`;
const managerId = `${run}-manager`;
const staffId = `${run}-staff`;
const allIds = [superId, super2Id, adminId, admin2Id, managerId, staffId];

type Principal = {
  userId: string;
  name: string;
  email: string;
  authVersion: number;
  mustChangePassword: boolean;
  role: "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "STAFF";
  teacherId: null;
};

function principalFor(id: string, role: Principal["role"], email: string): Principal {
  return {
    userId: id,
    name: "합성 관리자",
    email,
    authVersion: 1,
    mustChangePassword: false,
    role,
    teacherId: null,
  };
}

function superPrincipal() {
  return principalFor(superId, "SUPER_ADMIN", `${run}-super@example.test`);
}

function staffPrincipal() {
  return principalFor(staffId, "STAFF", `${run}-staff@example.test`);
}

/** React cache()를 쓰는 가드 모듈을 세션 전환마다 새로 로드한다. */
async function freshAuthorization() {
  vi.resetModules();
  return import("@/lib/auth/authorization");
}

async function freshActions() {
  vi.resetModules();
  return import("@/app/(admin)/accounts/actions");
}

async function freshMutations() {
  vi.resetModules();
  return import("@/server/accounts/mutations");
}

async function freshQueries() {
  vi.resetModules();
  return import("@/server/accounts/queries");
}

function accountForm(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

async function snapshotUser(id: string) {
  const row = await db.user.findUniqueOrThrow({ where: { id } });
  return {
    role: row.role,
    email: row.email,
    isActive: row.isActive,
    authVersion: row.authVersion,
    mustChangePassword: row.mustChangePassword,
    password: row.password,
  };
}

beforeAll(async () => {
  process.env[CUTOVER_ENV] = "SUPER_ADMIN";
  // 합성 최고관리자·관리자 픽스처를 직접 삽입한다 (일반 경로 생성도 가능하지만,
  // 픽스처는 테스트 전제이지 제품 경로 검증 대상이 아니다).
  await db.user.createMany({
    data: [
      { id: superId, name: "합성 최고관리자", email: `${run}-super@example.test`, password: "synthetic-hash", role: "SUPER_ADMIN", isActive: true, mustChangePassword: false, authVersion: 1 },
      { id: super2Id, name: "합성 최고관리자2", email: `${run}-super2@example.test`, password: "synthetic-hash", role: "SUPER_ADMIN", isActive: true, mustChangePassword: false, authVersion: 1 },
      { id: adminId, name: "합성 관리자", email: `${run}-admin@example.test`, password: "synthetic-hash", role: "ADMIN", isActive: true, mustChangePassword: false, authVersion: 1 },
      { id: admin2Id, name: "합성 관리자2", email: `${run}-admin2@example.test`, password: "synthetic-hash", role: "ADMIN", isActive: true, mustChangePassword: false, authVersion: 1 },
      { id: managerId, name: "합성 매니저", email: `${run}-manager@example.test`, password: "synthetic-hash", role: "MANAGER", isActive: true, mustChangePassword: false, authVersion: 1 },
      { id: staffId, name: "합성 직원", email: `${run}-staff@example.test`, password: "synthetic-hash", role: "STAFF", isActive: true, mustChangePassword: false, authVersion: 1 },
    ],
  });
  // 본인 이력 전용 경로 검증용 픽스처 행 (대상별 1건씩, 행위자는 SUPER_ADMIN).
  await db.userAccountChange.createMany({
    data: [
      { targetUserId: staffId, actorAdminId: superId, type: "CREATED", nextEmail: `${run}-staff@example.test`, nextRole: "STAFF", nextIsActive: true },
      { targetUserId: adminId, actorAdminId: superId, type: "CREATED", nextEmail: `${run}-admin@example.test`, nextRole: "ADMIN", nextIsActive: true },
    ],
  });
}, 30000);

afterAll(async () => {
  if (originalCutoverMode === undefined) delete process.env[CUTOVER_ENV];
  else process.env[CUTOVER_ENV] = originalCutoverMode;
  // 이 run의 합성 기록만, FK 순서대로 정리한다. reset·migration·공유 정리는 하지 않는다.
  await db.userAccountChange.deleteMany({
    where: { OR: [{ targetUserId: { in: allIds } }, { actorAdminId: { in: allIds } }] },
  });
  await db.user.deleteMany({ where: { id: { in: allIds } } });
  await db.$disconnect();
}, 30000);

describe.sequential("P2 account guard transition (isolated PostgreSQL)", () => {
  it("allows SUPER_ADMIN creation through the general path (validation, core, and DB)", async () => {
    const actionEmail = `${run}-new-super@example.test`;
    const coreEmail = `${run}-core-super@example.test`;
    sessionHolder.userId = superId;
    const actions = await freshActions();
    const mutations = await freshMutations();

    // (a) 서버 액션 경유 생성: SUPER_ADMIN 역할이 zod 검증을 통과하고,
    // 비밀번호 없이 비활성·비밀번호 null로 생성된다. 성공 시 redirect를 던진다.
    await expect(actions.createAccount(
      {},
      accountForm({
        name: "신규 최고관리자",
        email: actionEmail,
        role: "SUPER_ADMIN",
        isActive: "on",
      }),
    )).rejects.toThrow(/^REDIRECT:\/accounts\//);
    const actionCreated = await db.user.findUniqueOrThrow({ where: { email: actionEmail } });
    allIds.push(actionCreated.id);
    expect(actionCreated.role).toBe("SUPER_ADMIN");
    expect(actionCreated.password).toBeNull();
    expect(actionCreated.isActive).toBe(false);
    expect(actionCreated.mustChangePassword).toBe(false);
    expect(
      await db.userAccountChange.count({
        where: { targetUserId: actionCreated.id, type: "CREATED", actorAdminId: superId },
      }),
    ).toBe(1);

    // (b) 코어 직접 호출: ADMIN 행위자도 SUPER_ADMIN을 생성할 수 있다.
    const coreCreated = await mutations.createAccountCore(
      { userId: adminId, name: "합성 관리자", email: `${run}-admin@example.test`, authVersion: 1, mustChangePassword: false, role: "ADMIN", teacherId: null } as never,
      {
        name: "코어 최고관리자",
        email: coreEmail,
        role: "SUPER_ADMIN",
        teacherId: null,
        isActive: true,
        passwordHash: "synthetic-hash",
      },
    );
    allIds.push(coreCreated.id);
    const coreRow = await db.user.findUniqueOrThrow({ where: { email: coreEmail } });
    expect(coreRow.role).toBe("SUPER_ADMIN");
    expect(coreRow.isActive).toBe(true);
    expect(
      await db.userAccountChange.count({
        where: { targetUserId: coreCreated.id, type: "CREATED", actorAdminId: adminId },
      }),
    ).toBe(1);
  });

  it("allows SUPER_ADMIN promotion and demotion through the general path", async () => {
    sessionHolder.userId = superId;
    const actions = await freshActions();
    const mutations = await freshMutations();

    // (a) 코어 직접 호출: STAFF → SUPER_ADMIN 승격, 행·감사·authVersion 일치.
    const promoted = await mutations.createAccountCore(superPrincipal(), {
      name: "승격 대상",
      email: `${run}-promote@example.test`,
      role: "STAFF",
      teacherId: null,
      isActive: true,
      passwordHash: null,
    });
    allIds.push(promoted.id);
    const beforePromote = await snapshotUser(promoted.id);
    await mutations.updateAccountCore(superPrincipal(), promoted.id, {
      name: "승격 대상",
      email: `${run}-promote@example.test`,
      role: "SUPER_ADMIN",
      teacherId: null,
      isActive: true,
    });
    const afterPromote = await snapshotUser(promoted.id);
    expect(afterPromote.role).toBe("SUPER_ADMIN");
    expect(afterPromote.authVersion).toBe(beforePromote.authVersion + 1);
    expect(
      await db.userAccountChange.count({
        where: { targetUserId: promoted.id, type: "ROLE_CHANGED", actorAdminId: superId },
      }),
    ).toBe(1);
    const promoteAudit = await db.userAccountChange.findFirstOrThrow({
      where: { targetUserId: promoted.id, type: "ROLE_CHANGED" },
    });
    expect(promoteAudit.previousRole).toBe("STAFF");
    expect(promoteAudit.nextRole).toBe("SUPER_ADMIN");

    // (b) 코어 직접 호출: ADMIN 본인 강등은 다른 관리자가 있으면 허용된다.
    const selfDemote = await mutations.createAccountCore(superPrincipal(), {
      name: "본인 강등 대상",
      email: `${run}-selfdemote@example.test`,
      role: "ADMIN",
      teacherId: null,
      isActive: true,
      passwordHash: "synthetic-hash",
    });
    allIds.push(selfDemote.id);
    await db.user.update({ where: { id: selfDemote.id }, data: { mustChangePassword: false } });
    const selfPrincipal = {
      userId: selfDemote.id,
      name: "본인 강등 대상",
      email: `${run}-selfdemote@example.test`,
      authVersion: 1,
      mustChangePassword: false,
      role: "ADMIN" as const,
      teacherId: null,
    };
    await mutations.updateAccountCore(selfPrincipal as never, selfDemote.id, {
      name: "본인 강등 대상",
      email: `${run}-selfdemote@example.test`,
      role: "MANAGER",
      teacherId: null,
      isActive: true,
    });
    expect((await snapshotUser(selfDemote.id)).role).toBe("MANAGER");

    // (c) 코어 직접 호출: 다른 SUPER_ADMIN 대상 강등도 허용된다.
    await mutations.updateAccountCore(superPrincipal(), promoted.id, {
      name: "승격 대상",
      email: `${run}-promote@example.test`,
      role: "ADMIN",
      teacherId: null,
      isActive: true,
    });
    expect((await snapshotUser(promoted.id)).role).toBe("ADMIN");

    // (d) 서버 액션 경유: STAFF → SUPER_ADMIN 승격이 zod 검증을 통과한다.
    const actionTarget = await mutations.createAccountCore(superPrincipal(), {
      name: "액션 승격 대상",
      email: `${run}-action-promote@example.test`,
      role: "STAFF",
      teacherId: null,
      isActive: true,
      passwordHash: null,
    });
    allIds.push(actionTarget.id);
    await expect(actions.updateAccount(
      actionTarget.id,
      {},
      accountForm({
        name: "액션 승격 대상",
        email: `${run}-action-promote@example.test`,
        role: "SUPER_ADMIN",
        isActive: "on",
      }),
    )).rejects.toThrow(`REDIRECT:/accounts/${actionTarget.id}`);
    expect((await snapshotUser(actionTarget.id)).role).toBe("SUPER_ADMIN");
  });

  it("allows general-path credential reset of a SUPER_ADMIN target", async () => {
    sessionHolder.userId = superId;
    const actions = await freshActions();
    const mutations = await freshMutations();
    const target = await mutations.createAccountCore(superPrincipal(), {
      name: "재설정 대상 최고관리자",
      email: `${run}-reset-super@example.test`,
      role: "SUPER_ADMIN",
      teacherId: null,
      isActive: true,
      passwordHash: "synthetic-hash",
    });
    allIds.push(target.id);
    const before = await snapshotUser(target.id);

    // (a) 코어 직접 호출: 해시 교체·강제 변경·authVersion 증가, 감사 기록.
    await mutations.resetAccountPasswordCore(superPrincipal(), target.id, "synthetic-new-hash");
    const afterCore = await snapshotUser(target.id);
    expect(afterCore.password).toBe("synthetic-new-hash");
    expect(afterCore.mustChangePassword).toBe(true);
    expect(afterCore.authVersion).toBe(before.authVersion + 1);
    expect(
      await db.userAccountChange.count({
        where: { targetUserId: target.id, type: "PASSWORD_RESET", actorAdminId: superId },
      }),
    ).toBe(1);

    // (b) 서버 액션 경유: 성공하고 행이 바뀐다.
    const actionResult = await actions.resetAccountPassword(
      target.id,
      {},
      accountForm({ temporaryPassword: "synthetic-pass-123" }),
    );
    expect(actionResult.success).toBe(true);
    const afterAction = await snapshotUser(target.id);
    expect(afterAction.password).not.toBe("synthetic-new-hash");
    expect(afterAction.mustChangePassword).toBe(true);
    expect(afterAction.authVersion).toBe(before.authVersion + 2);
  });

  it("allows SUPER_ADMIN general management: passwordless creation, update, and reset", async () => {
    sessionHolder.userId = superId;
    sessionHolder.authVersion = 1;
    const actions = await freshActions();

    // (a) 서버 액션 경유 생성: 비밀번호 입력 없이 생성되며 비활성·비밀번호 null로 저장된다.
    // 성공 시 액션은 redirect를 던지므로 REDIRECT로 받고 행을 재조회한다.
    const newEmail = `${run}-new-staff@example.test`;
    await expect(actions.createAccount(
      {},
      accountForm({ name: "합성 신규 직원", email: newEmail, role: "STAFF" }),
    )).rejects.toThrow(/^REDIRECT:\/accounts\//);
    const created = await db.user.findUniqueOrThrow({ where: { email: newEmail } });
    expect(created.role).toBe("STAFF");
    expect(created.password).toBeNull();
    expect(created.isActive).toBe(false);
    expect(created.mustChangePassword).toBe(false);
    expect(
      await db.userAccountChange.count({
        where: { targetUserId: created.id, type: "CREATED", actorAdminId: superId },
      }),
    ).toBe(1);
    allIds.push(created.id);

    // (b) 서버 액션 경유 수정: ADMIN → MANAGER 역할 변경, 행·감사 일치.
    await expect(actions.updateAccount(
      admin2Id,
      {},
      accountForm({
        name: "합성 관리자2",
        email: `${run}-admin2@example.test`,
        role: "MANAGER",
        isActive: "on",
      }),
    )).rejects.toThrow(`REDIRECT:/accounts/${admin2Id}`);
    const updated = await snapshotUser(admin2Id);
    expect(updated.role).toBe("MANAGER");
    expect(
      await db.userAccountChange.count({
        where: { targetUserId: admin2Id, type: "ROLE_CHANGED", actorAdminId: superId },
      }),
    ).toBe(1);

    // (c) 서버 액션 경유 재설정: 해시 교체·강제 변경·authVersion 증가, 감사에 비밀값 없음.
    const resetResult = await actions.resetAccountPassword(
      admin2Id,
      {},
      accountForm({ temporaryPassword: "synthetic-pass-123" }),
    );
    expect(resetResult.success).toBe(true);
    const reset = await snapshotUser(admin2Id);
    expect(reset.password).not.toBe("synthetic-hash");
    expect(reset.mustChangePassword).toBe(true);
    expect(reset.authVersion).toBe(3);
    const resetAudit = await db.userAccountChange.findFirstOrThrow({
      where: { targetUserId: admin2Id, type: "PASSWORD_RESET", actorAdminId: superId },
    });
    expect(JSON.stringify(resetAudit)).not.toContain("synthetic-pass-123");
  });

  it("allows ADMIN account management (guards, actions, queries, DB)", async () => {
    sessionHolder.userId = adminId;
    sessionHolder.authVersion = 1;
    const actions = await freshActions();
    const queries = await freshQueries();

    // 서버 액션 3곳 모두 ADMIN 세션에서 통과한다.
    const newEmail = `${run}-admin-created@example.test`;
    await expect(actions.createAccount(
      {},
      accountForm({ name: "관리자 생성 직원", email: newEmail, role: "STAFF" }),
    )).rejects.toThrow(/^REDIRECT:\/accounts\//);
    const created = await db.user.findUniqueOrThrow({ where: { email: newEmail } });
    allIds.push(created.id);
    expect(created.role).toBe("STAFF");
    expect(
      await db.userAccountChange.count({
        where: { targetUserId: created.id, type: "CREATED", actorAdminId: adminId },
      }),
    ).toBe(1);

    await expect(actions.updateAccount(
      created.id,
      {},
      accountForm({
        name: "관리자 생성 직원",
        email: newEmail,
        role: "MANAGER",
        isActive: "on",
      }),
    )).rejects.toThrow(`REDIRECT:/accounts/${created.id}`);
    expect((await snapshotUser(created.id)).role).toBe("MANAGER");

    const resetResult = await actions.resetAccountPassword(
      created.id,
      {},
      accountForm({ temporaryPassword: "synthetic-pass-123" }),
    );
    expect(resetResult.success).toBe(true);
    expect((await snapshotUser(created.id)).mustChangePassword).toBe(true);

    // 쿼리 3곳(목록·상세·선생님 선택지) 모두 ADMIN 세션에서 통과한다.
    const accounts = await queries.listAccounts();
    expect(accounts.some((account) => account.id === adminId)).toBe(true);
    const detail = await queries.getAccountDetail(created.id);
    expect(detail?.account.id).toBe(created.id);
    expect(Array.isArray(await queries.listAvailableAccountTeachers())).toBe(true);
  });

  it("allows demotion while other active managers remain (LAST_ACTIVE_MANAGER positive control)", async () => {
    sessionHolder.userId = superId;
    const mutations = await freshMutations();
    const target = await mutations.createAccountCore(superPrincipal(), {
      name: "강등 대조 대상",
      email: `${run}-demote-control@example.test`,
      role: "ADMIN",
      teacherId: null,
      isActive: true,
      passwordHash: "synthetic-hash",
    });
    allIds.push(target.id);
    const countBefore = await db.user.count({
      where: { role: { in: ["ADMIN", "SUPER_ADMIN"] }, isActive: true },
    });
    expect(countBefore).toBeGreaterThan(1);
    await mutations.updateAccountCore(superPrincipal(), target.id, {
      name: "강등 대조 대상",
      email: `${run}-demote-control@example.test`,
      role: "MANAGER",
      teacherId: null,
      isActive: true,
    });
    expect((await snapshotUser(target.id)).role).toBe("MANAGER");
    const countAfter = await db.user.count({
      where: { role: { in: ["ADMIN", "SUPER_ADMIN"] }, isActive: true },
    });
    expect(countAfter).toBe(countBefore - 1);
  });

  it("allows SUPER_ADMIN through account guards and queries", async () => {
    sessionHolder.userId = superId;
    sessionHolder.authVersion = 1;
    const authorization = await freshAuthorization();
    const queries = await freshQueries();
    await expect(authorization.requireAccountManagementPrincipal()).resolves.toMatchObject({
      role: "SUPER_ADMIN",
    });
    const accounts = await queries.listAccounts();
    expect(accounts.some((account) => account.id === adminId)).toBe(true);
    const detail = await queries.getAccountDetail(adminId);
    expect(detail?.account.id).toBe(adminId);
    expect(Array.isArray(await queries.listAvailableAccountTeachers())).toBe(true);
  });

  it("denies STAFF at account and operational guards but allows only own history", async () => {
    sessionHolder.userId = staffId;
    sessionHolder.authVersion = 1;
    const authorization = await freshAuthorization();
    const mutations = await freshMutations();
    const queries = await freshQueries();
    await expect(authorization.requireOperationalPrincipal()).rejects.toThrow("NOT_FOUND");
    await expect(authorization.requireAdminOrSuperAdminPrincipal()).rejects.toThrow("NOT_FOUND");
    await expect(authorization.requireAdminPrincipal()).rejects.toThrow("NOT_FOUND");
    await expect(authorization.requireAccountManagementPrincipal()).rejects.toThrow("NOT_FOUND");
    await expect(queries.listAccounts()).rejects.toThrow("NOT_FOUND");
    await expect(queries.getAccountDetail(staffId)).rejects.toThrow("NOT_FOUND");

    // STAFF가 코어 행위자가 되어도 assertAccountManagementActor가 거부한다.
    const forgedEmail = `${run}-forged-staff@example.test`;
    await expect(
      mutations.createAccountCore(staffPrincipal(), {
        name: "위조 계정",
        email: forgedEmail,
        role: "STAFF",
        teacherId: null,
        isActive: true,
        passwordHash: null,
      }),
    ).rejects.toMatchObject({ code: "ACTOR_NOT_ACCOUNT_MANAGER" });
    expect(await db.user.findUnique({ where: { email: forgedEmail } })).toBeNull();

    // 본인 이력 전용 경로는 본인 행만 반환한다 (nextEmail로 대상을 구분한다 —
    // select에 targetUserId가 없어, ADMIN 픽스처 행이 섞이면 이메일이 달라진다).
    const own = await queries.listOwnAccountHistory();
    expect(own.length).toBe(1);
    expect(own[0]?.nextEmail).toBe(`${run}-staff@example.test`);
    expect(own.every((row) => row.actorAdmin.id === superId)).toBe(true);
  });

  it("returns only own history for ADMIN and denies MANAGER on the dedicated path", async () => {
    // ADMIN 세션: 본인 행 1건만 (픽스처), STAFF 행은 포함되지 않는다.
    sessionHolder.userId = adminId;
    sessionHolder.authVersion = 1;
    const adminQueries = await freshQueries();
    const adminOwn = await adminQueries.listOwnAccountHistory();
    expect(adminOwn.length).toBe(1);

    // MANAGER 세션: 전용 경로에서 거부된다 (P2 미결·차단 방향).
    sessionHolder.userId = managerId;
    const managerQueries = await freshQueries();
    await expect(managerQueries.listOwnAccountHistory()).rejects.toThrow("NOT_FOUND");

    // SUPER_ADMIN 세션: 전용 경로에서는 본인 행만 반환한다 (전체 이력은 상세 경로).
    sessionHolder.userId = superId;
    const superQueries = await freshQueries();
    const superOwn = await superQueries.listOwnAccountHistory();
    expect(superOwn.length).toBe(0);
  });

  it("preserves ADMIN operational authority (guards pass; account management allowed)", async () => {
    sessionHolder.userId = adminId;
    sessionHolder.authVersion = 1;
    const authorization = await freshAuthorization();
    await expect(authorization.requireOperationalPrincipal()).resolves.toMatchObject({
      role: "ADMIN",
    });
    await expect(authorization.requireAdminOrSuperAdminPrincipal()).resolves.toMatchObject({
      role: "ADMIN",
    });
    await expect(authorization.requireAdminPrincipal()).resolves.toMatchObject({
      role: "ADMIN",
    });
    await expect(authorization.requireAccountManagementPrincipal()).resolves.toMatchObject({
      role: "ADMIN",
    });
  });

  it("produces no duplicate audit rows on an identical re-submit", async () => {
    sessionHolder.userId = superId;
    sessionHolder.authVersion = 1;
    const mutations = await freshMutations();
    // 이 테스트 전용 대상을 코어로 생성한다 (다른 테스트의 픽스처를 오염시키지 않는다).
    const targetEmail = `${run}-resubmit@example.test`;
    const created = await mutations.createAccountCore(superPrincipal(), {
      name: "재제출 대상",
      email: targetEmail,
      role: "STAFF",
      teacherId: null,
      isActive: true,
      passwordHash: null,
    });
    allIds.push(created.id);
    // 이름 변경은 감사 대상이 아니므로, 이메일·역할 변경으로 감사 행을 만든다.
    const changed = {
      name: "재제출 대상",
      email: `${run}-resubmit2@example.test`,
      role: "MANAGER" as const,
      teacherId: null,
      isActive: false,
    };
    await mutations.updateAccountCore(superPrincipal(), created.id, changed);
    const afterFirst = await db.userAccountChange.count({ where: { targetUserId: created.id } });
    // CREATED 1건 + 이메일 변경 1건 + 역할 변경 1건.
    expect(afterFirst).toBe(3);
    // 동일 입력 재제출: 변경 없음이므로 감사 행이 추가되지 않고 성공한다.
    await mutations.updateAccountCore(superPrincipal(), created.id, changed);
    const afterSecond = await db.userAccountChange.count({ where: { targetUserId: created.id } });
    expect(afterSecond).toBe(3);
  });

  it("reflects role change and authVersion invalidation on the next live principal lookup", async () => {
    // 전제: SUPER_ADMIN 관리 테스트에서 admin2는 MANAGER로 변경되고 재설정으로
    // authVersion이 3이 됐다. 낡은 세션(authVersion 1)은 로그인으로, 새 세션은 새 역할로 해석된다.
    sessionHolder.userId = admin2Id;
    sessionHolder.authVersion = 1;
    const stale = await freshAuthorization();
    await expect(stale.requirePasswordChangePrincipal()).rejects.toThrow("REDIRECT:/login");

    sessionHolder.authVersion = 3;
    const fresh = await freshAuthorization();
    await expect(fresh.requirePasswordChangePrincipal()).resolves.toMatchObject({
      role: "MANAGER",
      authVersion: 3,
      mustChangePassword: true,
    });
  });
});
