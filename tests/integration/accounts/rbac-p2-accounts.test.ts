/**
 * P2 account guard transition — executed against an isolated PostgreSQL 16.
 *
 * P1의 rbac-p1-bypass.test.ts를 대체한다. P1 파일은 ADMIN 행위자의 일반 계정 생성을
 * 허용 전제로 검증했으나, P2 전환 계약에서는 ADMIN의 계정 관리 자체가 차단되므로
 * 해당 전제가 뒤집혔다. P1 파일은 삭제하고 이 파일이 P2 계약을 검증한다.
 *
 * 실행 환경: 독립 임시 PG16 (127.0.0.1:55432, DB/user yaho_e2e, DB 안전 게이트 통과 URL),
 * 기존 migration 15건 적용 + P1 draft migration 적용 상태. 실제 프로젝트 DB(Preview/Production)에는
 * 절대 접속하지 않는다. 합성 관리자 및 테스트 데이터만 사용한다.
 *
 * 검증 경계 (정직한 표기):
 * - 실제: 서버 가드(모드별 requireAccountManagementPrincipal / requireAdminPrincipal /
 *   requireAdminOrSuperAdminPrincipal / requireOperationalPrincipal), 계정 코어
 *   (P2-S: 이 파일은 SUPER_ADMIN 모드에서 실행한다 — beforeAll에서 환경변수를
 *   SUPER_ADMIN으로 설정하고 afterAll에서 복원한다. LEGACY·INVALID 모드는
 *   rbac-p2safe-cutover.test.ts에서 검증한다.)
 *   (create/update/resetAccountCore), 계정 쿼리(listAccounts/getAccountDetail/
 *   listAvailableAccountTeachers/listOwnAccountHistory), 실제 DB 쓰기 결과,
 *   거부 시 DB 행·권한·감사 상태 불변, live principal 반영·authVersion 무효화.
 * - 스텁된 부분: 세션 전송 계층만 mock한다 (`@/auth`의 auth()가 합성 세션을 반환하고,
 *   실제 resolveSessionPrincipal이 격리 DB 행을 읽어 principal을 만든다). HTTP 요청 전송 계층은
 *   검증하지 않는다 — 계정 액션은 HTTP 라우트 표면이 아니라 서버 액션이라, 이 파일의 호출은
 *   HTTP 배선을 입증하지 않는다. 따라서 HTTP 배선 검증은 PASS가 아니라 NOT VERIFIED로 기록한다.
 * - LAST_ACTIVE_SUPER_ADMIN은 일반 경로에서 본인 보호·blanket에 먼저 걸려 실제 DB로는
 *   도달하지 않으므로, 판정 순서·코드는 목 기반 단위 테스트에서만 검증하고 이 파일에서는
 *   SUPER_ADMIN 대상 일반 변경이 blanket으로 거부됨을 검증한다.
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
  // SUPER_ADMIN 행은 일반 경로로 만들 수 없으므로, 이미 존재하는 최고관리자를 가정하는
  // 픽스처로 직접 삽입한다 (제품 경로 우회가 아니다).
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
  it("rejects SUPER_ADMIN creation through the general path (validation layer, core, and DB)", async () => {
    const forgedEmail = `${run}-forged-super@example.test`;
    sessionHolder.userId = superId;
    const actions = await freshActions();
    const mutations = await freshMutations();

    // (a) 서버 액션 경유 위조 페이로드: zod 검증 단계에서 거부된다.
    const actionResult = await actions.createAccount(
      {},
      accountForm({
        name: "위조 최고관리자",
        email: forgedEmail,
        role: "SUPER_ADMIN",
        isActive: "on",
      }),
    );
    expect(actionResult.errors?.role).toBeDefined();
    expect(await db.user.findUnique({ where: { email: forgedEmail } })).toBeNull();
    expect(
      await db.userAccountChange.count({ where: { nextEmail: forgedEmail } }),
    ).toBe(0);

    // (b) 코어 직접 호출 (검증 우회 시도): 쓰기 전에 SUPER_ADMIN_FORBIDDEN으로 거부된다.
    await expect(
      mutations.createAccountCore(superPrincipal(), {
        name: "위조 최고관리자",
        email: forgedEmail,
        role: "SUPER_ADMIN",
        teacherId: null,
        isActive: true,
        passwordHash: "synthetic-hash",
      }),
    ).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
    expect(await db.user.findUnique({ where: { email: forgedEmail } })).toBeNull();
    expect(
      await db.userAccountChange.count({ where: { nextEmail: forgedEmail } }),
    ).toBe(0);
  });

  it("rejects SUPER_ADMIN promotion and demotion through the general path", async () => {
    sessionHolder.userId = superId;
    const actions = await freshActions();
    const mutations = await freshMutations();
    const managerBefore = await snapshotUser(managerId);
    const superBefore = await snapshotUser(superId);

    // (a) 코어 직접 호출: MANAGER → SUPER_ADMIN 승격 거부, 행 불변, 감사 불변.
    await expect(
      mutations.updateAccountCore(superPrincipal(), managerId, {
        name: "합성 매니저",
        email: `${run}-manager@example.test`,
        role: "SUPER_ADMIN",
        teacherId: null,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
    expect(await snapshotUser(managerId)).toEqual(managerBefore);
    expect(await db.userAccountChange.count({ where: { targetUserId: managerId } })).toBe(0);

    // (b) 코어 직접 호출: SUPER_ADMIN 본인 강등은 본인 보호(SELF_ROLE_CHANGE)로 거부된다.
    // 본인 검사가 blanket보다 먼저 판정되기 때문이다. 행 불변, 감사 불변.
    await expect(
      mutations.updateAccountCore(superPrincipal(), superId, {
        name: "바뀐 이름",
        email: `${run}-super@example.test`,
        role: "ADMIN",
        teacherId: null,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "SELF_ROLE_CHANGE" });
    expect(await snapshotUser(superId)).toEqual(superBefore);
    expect(await db.userAccountChange.count({ where: { targetUserId: superId } })).toBe(0);

    // (b2) 코어 직접 호출: 다른 SUPER_ADMIN 대상 일반 수정은 blanket으로 거부된다.
    const super2Before = await snapshotUser(super2Id);
    await expect(
      mutations.updateAccountCore(superPrincipal(), super2Id, {
        name: "바뀐 이름",
        email: `${run}-super2@example.test`,
        role: "ADMIN",
        teacherId: null,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
    expect(await snapshotUser(super2Id)).toEqual(super2Before);
    expect(await db.userAccountChange.count({ where: { targetUserId: super2Id } })).toBe(0);

    // (c) 서버 액션 경유: zod 검증 단계에서 거부되고 행이 바뀌지 않는다.
    const actionResult = await actions.updateAccount(
      managerId,
      {},
      accountForm({
        name: "합성 매니저",
        email: `${run}-manager@example.test`,
        role: "SUPER_ADMIN",
        isActive: "on",
      }),
    );
    expect(actionResult.errors?.role).toBeDefined();
    expect(await snapshotUser(managerId)).toEqual(managerBefore);
  });

  it("rejects general-path credential reset of a SUPER_ADMIN target", async () => {
    sessionHolder.userId = superId;
    const actions = await freshActions();
    const mutations = await freshMutations();
    const superBefore = await snapshotUser(superId);

    // (a) 코어 직접 호출: SUPER_ADMIN 대상 재설정 거부, credential·버전·감사 불변.
    await expect(
      mutations.resetAccountPasswordCore(superPrincipal(), superId, "synthetic-new-hash"),
    ).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
    expect(await snapshotUser(superId)).toEqual(superBefore);
    expect(
      await db.userAccountChange.count({
        where: { targetUserId: superId, type: "PASSWORD_RESET" },
      }),
    ).toBe(0);

    // (b) 서버 액션 경유: formError로 거부되고 행이 바뀌지 않는다.
    const actionResult = await actions.resetAccountPassword(
      superId,
      {},
      accountForm({ temporaryPassword: "synthetic-pass-123" }),
    );
    expect(actionResult.formError).toMatch("최고관리자");
    expect(await snapshotUser(superId)).toEqual(superBefore);
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
    expect(reset.authVersion).toBe(2);
    const resetAudit = await db.userAccountChange.findFirstOrThrow({
      where: { targetUserId: admin2Id, type: "PASSWORD_RESET", actorAdminId: superId },
    });
    expect(JSON.stringify(resetAudit)).not.toContain("synthetic-pass-123");
  });

  it("denies ADMIN account management after the transition (guards, actions, queries, DB unchanged)", async () => {
    sessionHolder.userId = adminId;
    sessionHolder.authVersion = 1;
    const actions = await freshActions();
    const queries = await freshQueries();
    const managerBefore = await snapshotUser(managerId);

    // 서버 액션 3곳 모두 가드에서 거부된다.
    await expect(actions.createAccount(
      {},
      accountForm({ name: "위조", email: `${run}-forged@example.test`, role: "STAFF" }),
    )).rejects.toThrow("NOT_FOUND");
    await expect(actions.updateAccount(
      managerId,
      {},
      accountForm({
        name: "합성 매니저",
        email: `${run}-manager@example.test`,
        role: "STAFF",
        isActive: "on",
      }),
    )).rejects.toThrow("NOT_FOUND");
    await expect(actions.resetAccountPassword(
      managerId,
      {},
      accountForm({ temporaryPassword: "synthetic-pass-123" }),
    )).rejects.toThrow("NOT_FOUND");

    // 쿼리 3곳(목록·상세·선생님 선택지) 모두 가드에서 거부된다 — choke point 전환 확인.
    await expect(queries.listAccounts()).rejects.toThrow("NOT_FOUND");
    await expect(queries.getAccountDetail(managerId)).rejects.toThrow("NOT_FOUND");
    await expect(queries.listAvailableAccountTeachers()).rejects.toThrow("NOT_FOUND");

    expect(await snapshotUser(managerId)).toEqual(managerBefore);
    expect(await db.user.findUnique({ where: { email: `${run}-forged@example.test` } })).toBeNull();
    expect(await db.userAccountChange.count({ where: { targetUserId: managerId } })).toBe(0);
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

  it("preserves ADMIN operational authority (guards pass; account management stays blocked)", async () => {
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
    await expect(authorization.requireAccountManagementPrincipal()).rejects.toThrow("NOT_FOUND");
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
    // authVersion이 2가 됐다. 낡은 세션(authVersion 1)은 로그인으로, 새 세션은 새 역할로 해석된다.
    sessionHolder.userId = admin2Id;
    sessionHolder.authVersion = 1;
    const stale = await freshAuthorization();
    await expect(stale.requirePasswordChangePrincipal()).rejects.toThrow("REDIRECT:/login");

    sessionHolder.authVersion = 2;
    const fresh = await freshAuthorization();
    await expect(fresh.requirePasswordChangePrincipal()).resolves.toMatchObject({
      role: "MANAGER",
      authVersion: 2,
      mustChangePassword: true,
    });
  });
});
