/**
 * 단순화 결정(ADR-071) — 계정 관리는 전환 모드와 무관함을 격리 PostgreSQL 16에서 검증한다.
 *
 * P2 파일(rbac-p2-accounts.test.ts)은 SUPER_ADMIN 모드 전제의 계정 관리 계약을 검증하고,
 * 이 파일은 LEGACY_ADMIN / SUPER_ADMIN / INVALID 모드를 바꿔도 계정 관리 접근이
 * 변하지 않음을 검증한다. 핵심 명제: 계정 관리 권한은 역할(ADMIN 또는 SUPER_ADMIN)만으로
 * 정해지며, 모드 값은 계정 관리 경로에서 판정하지 않는다.
 *
 * 실행 환경: 독립 임시 PG16 (127.0.0.1:55432, DB/user yaho_e2e, DB 안전 게이트 통과 URL),
 * 기존 migration 15건 적용 + P1 draft migration 적용 상태. 실제 프로젝트 DB(Preview/Production)에는
 * 절대 접속하지 않는다. 합성 관리자 및 테스트 데이터만 사용한다.
 *
 * 검증 경계 (정직한 표기):
 * - 실제: 모드 무관 서버 가드(requireAccountManagementPrincipal), 계정 코어
 *   (assertAccountManagementActor — 역할만 판정), 계정 쿼리·액션,
 *   실제 DB 쓰기 결과, 모드 전환 시 동작 불변.
 * - 스텁된 부분: 세션 전송 계층만 mock한다 (`@/auth`의 auth()가 합성 세션을 반환하고,
 *   실제 resolveSessionPrincipal이 격리 DB 행을 읽어 principal을 만든다). HTTP 요청 전송
 *   계층은 검증하지 않는다 — HTTP/E2E 배선은 tests/e2e/p2safe-cutover.spec.ts에서 검증한다.
 * - 테스트 간 순서 의존: describe.sequential이며, 모드 전환 테스트는 앞선 테스트가
 *   남긴 행 상태를 전제로 하지 않고 run별 고유 이메일·행으로 독립 검증한다.
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

const CUTOVER_ENV = "YAHO_ADMIN_CUTOVER_MODE";
const originalCutoverMode = process.env[CUTOVER_ENV];

const run = `p2safeint-${crypto.randomUUID()}`;
const superId = `${run}-super`;
const adminId = `${run}-admin`;
const managerId = `${run}-manager`;
const manager2Id = `${run}-manager2`;
const staffId = `${run}-staff`;
const allIds = [superId, adminId, managerId, manager2Id, staffId];

function setMode(mode: string) {
  process.env[CUTOVER_ENV] = mode;
}

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

function superPrincipal() {
  return {
    userId: superId,
    name: "합성 최고관리자",
    email: `${run}-super@example.test`,
    authVersion: 1,
    mustChangePassword: false,
    role: "SUPER_ADMIN" as const,
    teacherId: null,
  };
}

function adminPrincipal() {
  return {
    userId: adminId,
    name: "합성 관리자",
    email: `${run}-admin@example.test`,
    authVersion: 1,
    mustChangePassword: false,
    role: "ADMIN" as const,
    teacherId: null,
  };
}

beforeAll(async () => {
  await db.user.createMany({
    data: [
      { id: superId, name: "합성 최고관리자", email: `${run}-super@example.test`, password: "synthetic-hash", role: "SUPER_ADMIN", isActive: true, mustChangePassword: false, authVersion: 1 },
      { id: adminId, name: "합성 관리자", email: `${run}-admin@example.test`, password: "synthetic-hash", role: "ADMIN", isActive: true, mustChangePassword: false, authVersion: 1 },
      { id: managerId, name: "합성 매니저", email: `${run}-manager@example.test`, password: "synthetic-hash", role: "MANAGER", isActive: true, mustChangePassword: false, authVersion: 1 },
      // 본인 이력 테스트 전용 MANAGER 행 — 다른 테스트에서 역할을 바꾸지 않는다
      // (LEGACY 관리 테스트가 managerId의 역할을 STAFF로 바꾸므로, 매니저 거부는
      // 이 행으로 검증해야 세션 무효·역할 변경 오염에 걸리지 않는다).
      { id: manager2Id, name: "합성 매니저2", email: `${run}-manager2@example.test`, password: "synthetic-hash", role: "MANAGER", isActive: true, mustChangePassword: false, authVersion: 1 },
      { id: staffId, name: "합성 직원", email: `${run}-staff@example.test`, password: "synthetic-hash", role: "STAFF", isActive: true, mustChangePassword: false, authVersion: 1 },
    ],
  });
  // 본인 이력 전용 경로 검증용 픽스처 행 (대상별 1건씩, 행위자는 SUPER_ADMIN).
  await db.userAccountChange.createMany({
    data: [
      { targetUserId: adminId, actorAdminId: superId, type: "CREATED", nextEmail: `${run}-admin@example.test`, nextRole: "ADMIN", nextIsActive: true },
      { targetUserId: staffId, actorAdminId: superId, type: "CREATED", nextEmail: `${run}-staff@example.test`, nextRole: "STAFF", nextIsActive: true },
    ],
  });
}, 30000);

afterAll(async () => {
  if (originalCutoverMode === undefined) delete process.env[CUTOVER_ENV];
  else process.env[CUTOVER_ENV] = originalCutoverMode;
  await db.userAccountChange.deleteMany({
    where: { OR: [{ targetUserId: { in: allIds } }, { actorAdminId: { in: allIds } }] },
  });
  await db.user.deleteMany({ where: { id: { in: allIds } } });
  await db.$disconnect();
}, 30000);

describe.sequential("단순화 결정(ADR-071) — 계정 관리는 모드와 무관하다 (격리 PostgreSQL)", () => {
  it("LEGACY_ADMIN mode allows ADMIN management through actions, queries, and core", async () => {
    setMode("LEGACY_ADMIN");
    sessionHolder.userId = adminId;
    sessionHolder.authVersion = 1;
    const actions = await freshActions();
    const queries = await freshQueries();

    // (a) 서버 액션 경유 생성: 비밀번호 없이 비활성 생성, CREATED 감사 행위자 = ADMIN.
    const newEmail = `${run}-legacy-staff@example.test`;
    await expect(actions.createAccount(
      {},
      accountForm({ name: "합성 신규 직원", email: newEmail, role: "STAFF" }),
    )).rejects.toThrow(/^REDIRECT:\/accounts\//);
    const created = await db.user.findUniqueOrThrow({ where: { email: newEmail } });
    allIds.push(created.id);
    expect(created.role).toBe("STAFF");
    expect(created.password).toBeNull();
    expect(created.isActive).toBe(false);
    expect(created.mustChangePassword).toBe(false);
    expect(
      await db.userAccountChange.count({
        where: { targetUserId: created.id, type: "CREATED", actorAdminId: adminId },
      }),
    ).toBe(1);

    // (b) 서버 액션 경유 수정: MANAGER → STAFF 역할 변경, 행·감사 일치.
    await expect(actions.updateAccount(
      managerId,
      {},
      accountForm({
        name: "합성 매니저",
        email: `${run}-manager@example.test`,
        role: "STAFF",
        isActive: "on",
      }),
    )).rejects.toThrow(`REDIRECT:/accounts/${managerId}`);
    expect((await snapshotUser(managerId)).role).toBe("STAFF");
    expect(
      await db.userAccountChange.count({
        where: { targetUserId: managerId, type: "ROLE_CHANGED", actorAdminId: adminId },
      }),
    ).toBe(1);

    // (c) 서버 액션 경유 재설정: 해시 교체·강제 변경·authVersion 증가.
    const resetResult = await actions.resetAccountPassword(
      managerId,
      {},
      accountForm({ temporaryPassword: "synthetic-pass-123" }),
    );
    expect(resetResult.success).toBe(true);
    const reset = await snapshotUser(managerId);
    expect(reset.password).not.toBe("synthetic-hash");
    expect(reset.mustChangePassword).toBe(true);
    expect(reset.authVersion).toBe(3);

    // (d) 쿼리 3곳 모두 ADMIN 세션에서 통과한다.
    const accounts = await queries.listAccounts();
    expect(accounts.some((account) => account.id === adminId)).toBe(true);
    const detail = await queries.getAccountDetail(managerId);
    expect(detail?.account.id).toBe(managerId);
    expect(Array.isArray(await queries.listAvailableAccountTeachers())).toBe(true);
  });

  it("LEGACY_ADMIN mode allows ADMIN to create and promote SUPER_ADMIN", async () => {
    setMode("LEGACY_ADMIN");
    sessionHolder.userId = adminId;
    sessionHolder.authVersion = 1;
    const actions = await freshActions();
    const mutations = await freshMutations();
    const superEmail = `${run}-legacy-super@example.test`;

    // (a) 서버 액션 경유 생성: SUPER_ADMIN 역할이 zod 검증을 통과하고
    // 비밀번호 없이 비활성으로 생성된다.
    await expect(actions.createAccount(
      {},
      accountForm({ name: "LEGACY 최고관리자", email: superEmail, role: "SUPER_ADMIN", isActive: "on" }),
    )).rejects.toThrow(/^REDIRECT:\/accounts\//);
    const actionCreated = await db.user.findUniqueOrThrow({ where: { email: superEmail } });
    allIds.push(actionCreated.id);
    expect(actionCreated.role).toBe("SUPER_ADMIN");
    expect(actionCreated.isActive).toBe(false);
    expect(
      await db.userAccountChange.count({
        where: { targetUserId: actionCreated.id, type: "CREATED", actorAdminId: adminId },
      }),
    ).toBe(1);

    // (b) 코어 직접 호출: ADMIN 행위자가 SUPER_ADMIN을 생성하고, 기존 STAFF를
    // SUPER_ADMIN으로 승격한다.
    const coreEmail = `${run}-legacy-core-super@example.test`;
    const coreCreated = await mutations.createAccountCore(adminPrincipal(), {
      name: "LEGACY 코어 최고관리자",
      email: coreEmail,
      role: "SUPER_ADMIN",
      teacherId: null,
      isActive: true,
      passwordHash: "synthetic-hash",
    });
    allIds.push(coreCreated.id);
    expect((await db.user.findUniqueOrThrow({ where: { email: coreEmail } })).role).toBe("SUPER_ADMIN");

    const promoteTarget = await mutations.createAccountCore(adminPrincipal(), {
      name: "LEGACY 승격 대상",
      email: `${run}-legacy-promote@example.test`,
      role: "STAFF",
      teacherId: null,
      isActive: true,
      passwordHash: null,
    });
    allIds.push(promoteTarget.id);
    await mutations.updateAccountCore(adminPrincipal(), promoteTarget.id, {
      name: "LEGACY 승격 대상",
      email: `${run}-legacy-promote@example.test`,
      role: "SUPER_ADMIN",
      teacherId: null,
      isActive: true,
    });
    expect((await snapshotUser(promoteTarget.id)).role).toBe("SUPER_ADMIN");
  });

  it("LEGACY_ADMIN mode allows a SUPER_ADMIN actor (role-based, no mode gate)", async () => {
    setMode("LEGACY_ADMIN");
    sessionHolder.userId = superId;
    sessionHolder.authVersion = 1;
    const authorization = await freshAuthorization();
    const actions = await freshActions();
    const mutations = await freshMutations();
    const queries = await freshQueries();

    // 가드·액션·쿼리·코어 전 계층에서 허용된다. DB 행 존재 여부와 무관하게 역할이 권한이다.
    await expect(authorization.requireAccountManagementPrincipal()).resolves.toMatchObject({
      role: "SUPER_ADMIN",
    });
    const newEmail = `${run}-legacy-super-created@example.test`;
    await expect(actions.createAccount(
      {},
      accountForm({ name: "LEGACY SUPER 생성", email: newEmail, role: "STAFF" }),
    )).rejects.toThrow(/^REDIRECT:\/accounts\//);
    const created = await db.user.findUniqueOrThrow({ where: { email: newEmail } });
    allIds.push(created.id);
    const accounts = await queries.listAccounts();
    expect(accounts.some((account) => account.id === superId)).toBe(true);
    const coreCreated = await mutations.createAccountCore(superPrincipal(), {
      name: "LEGACY SUPER 코어 생성",
      email: `${run}-legacy-super-core@example.test`,
      role: "STAFF",
      teacherId: null,
      isActive: true,
      passwordHash: null,
    });
    allIds.push(coreCreated.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: coreCreated.id } })).role).toBe("STAFF");
  });

  it("SUPER_ADMIN mode allows SUPER_ADMIN and ADMIN management (mode switch no longer changes access)", async () => {
    setMode("SUPER_ADMIN");
    sessionHolder.userId = superId;
    sessionHolder.authVersion = 1;
    const actions = await freshActions();
    const newEmail = `${run}-super-staff@example.test`;
    await expect(actions.createAccount(
      {},
      accountForm({ name: "합성 신규 직원", email: newEmail, role: "STAFF" }),
    )).rejects.toThrow(/^REDIRECT:\/accounts\//);
    const created = await db.user.findUniqueOrThrow({ where: { email: newEmail } });
    allIds.push(created.id);
    expect(created.isActive).toBe(false);
    expect(created.password).toBeNull();

    // 같은 파일 실행 중 모드를 바꿨을 뿐인데 ADMIN도 즉시 계정 관리를 수행한다.
    sessionHolder.userId = adminId;
    const adminActions = await freshActions();
    const adminMutations = await freshMutations();
    const adminQueries = await freshQueries();
    const adminEmail = `${run}-super-admin-created@example.test`;
    await expect(adminActions.createAccount(
      {},
      accountForm({ name: "ADMIN 생성", email: adminEmail, role: "STAFF" }),
    )).rejects.toThrow(/^REDIRECT:\/accounts\//);
    const adminCreated = await db.user.findUniqueOrThrow({ where: { email: adminEmail } });
    allIds.push(adminCreated.id);
    expect((await adminQueries.listAccounts()).some((account) => account.id === adminId)).toBe(true);
    const adminCoreCreated = await adminMutations.createAccountCore(adminPrincipal(), {
      name: "ADMIN 코어 생성",
      email: `${run}-super-admin-core@example.test`,
      role: "STAFF",
      teacherId: null,
      isActive: true,
      passwordHash: null,
    });
    allIds.push(adminCoreCreated.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: adminCoreCreated.id } })).role).toBe("STAFF");
  });

  it("INVALID mode still allows ADMIN and SUPER_ADMIN management (mode ignored)", async () => {
    setMode("BOGUS_MODE");
    const queries = await freshQueries();
    const mutations = await freshMutations();

    sessionHolder.userId = superId;
    sessionHolder.authVersion = 1;
    expect((await queries.listAccounts()).some((account) => account.id === superId)).toBe(true);
    const superCreated = await mutations.createAccountCore(superPrincipal(), {
      name: "INVALID SUPER 생성",
      email: `${run}-invalid-super@example.test`,
      role: "STAFF",
      teacherId: null,
      isActive: true,
      passwordHash: null,
    });
    allIds.push(superCreated.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: superCreated.id } })).role).toBe("STAFF");

    sessionHolder.userId = adminId;
    const adminQueries = await freshQueries();
    expect((await adminQueries.listAccounts()).some((account) => account.id === adminId)).toBe(true);
  });

  it("mode flips no longer change account management access", async () => {
    sessionHolder.userId = adminId;
    sessionHolder.authVersion = 1;
    const queries = await freshQueries();

    // 모듈 인스턴스를 갈아끼우지 않고 환경변수만 바꿔도 계정 관리 접근은 변하지 않는다.
    setMode("LEGACY_ADMIN");
    expect((await queries.listAccounts()).some((account) => account.id === adminId)).toBe(true);
    setMode("SUPER_ADMIN");
    expect((await queries.listAccounts()).some((account) => account.id === adminId)).toBe(true);
    setMode("LEGACY_ADMIN");
    expect((await queries.listAccounts()).some((account) => account.id === adminId)).toBe(true);
    setMode("BOGUS_MODE");
    expect((await queries.listAccounts()).some((account) => account.id === adminId)).toBe(true);
  });

  it("own history is mode-independent (OQ-12 contract holds in LEGACY_ADMIN mode)", async () => {
    setMode("LEGACY_ADMIN");
    sessionHolder.userId = adminId;
    sessionHolder.authVersion = 1;
    const adminQueries = await freshQueries();
    const adminOwn = await adminQueries.listOwnAccountHistory();
    expect(adminOwn.length).toBe(1);
    expect(adminOwn[0]?.nextEmail).toBe(`${run}-admin@example.test`);

    sessionHolder.userId = manager2Id;
    const managerQueries = await freshQueries();
    await expect(managerQueries.listOwnAccountHistory()).rejects.toThrow("NOT_FOUND");
  });

  it("produces no duplicate audit rows on an identical re-submit in LEGACY_ADMIN mode", async () => {
    setMode("LEGACY_ADMIN");
    const mutations = await freshMutations();
    const targetEmail = `${run}-legacy-resubmit@example.test`;
    const created = await mutations.createAccountCore(adminPrincipal(), {
      name: "재제출 대상",
      email: targetEmail,
      role: "STAFF",
      teacherId: null,
      isActive: true,
      passwordHash: null,
    });
    allIds.push(created.id);
    const changed = {
      name: "재제출 대상",
      email: `${run}-legacy-resubmit2@example.test`,
      role: "MANAGER" as const,
      teacherId: null,
      isActive: false,
    };
    await mutations.updateAccountCore(adminPrincipal(), created.id, changed);
    const afterFirst = await db.userAccountChange.count({ where: { targetUserId: created.id } });
    expect(afterFirst).toBe(3);
    await mutations.updateAccountCore(adminPrincipal(), created.id, changed);
    const afterSecond = await db.userAccountChange.count({ where: { targetUserId: created.id } });
    expect(afterSecond).toBe(3);
  });
});
