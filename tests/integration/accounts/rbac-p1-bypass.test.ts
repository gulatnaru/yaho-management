/**
 * P1 account API bypass defense — executed against an isolated PostgreSQL 16.
 *
 * 실행 환경: 독립 임시 PG16 (127.0.0.1:55432, DB/user yaho_e2e, DB 안전 게이트 통과 URL),
 * 기존 migration 15건 적용 + P1 draft migration 적용 상태. 실제 프로젝트 DB(Preview/Production)에는
 * 절대 접속하지 않는다. 합성 관리자 및 테스트 데이터만 사용한다.
 *
 * 검증 경계 (정직한 표기):
 * - 실제: 서버 가드(requireAdminPrincipal / requireAdminOrSuperAdminPrincipal /
 *   requireOperationalPrincipal), 계정 코어(create/update/resetAccountCore), 실제 DB 쓰기 결과,
 *   거부 시 DB 행·권한·감사 상태 불변.
 * - 스텁된 부분: 세션 전송 계층만 mock한다 (`@/auth`의 auth()가 합성 세션을 반환하고,
 *   실제 resolveSessionPrincipal이 격리 DB 행을 읽어 principal을 만든다). HTTP 요청 전송 계층은
 *   검증하지 않는다 — 계정 액션은 HTTP 라우트 표면이 아니라 서버 액션이라, 이 파일의 호출은
 *   HTTP 배선을 입증하지 않는다. 따라서 HTTP 배선 검증은 PASS가 아니라 NOT VERIFIED로 기록한다.
 * - 스텁 5번("denies STAFF at operational guards over real HTTP entry points")의 HTTP 범위는
 *   이 파일에서 서버 가드 수준으로 대체했으며, 이름·주장·증거 대응은 보고서에 명시한다.
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

const run = `p1int-${crypto.randomUUID()}`;
const adminId = `${run}-admin`;
const admin2Id = `${run}-admin2`;
const managerId = `${run}-manager`;
const superId = `${run}-super`;
const staffId = `${run}-staff`;
const allIds = [adminId, admin2Id, managerId, superId, staffId];

type Principal = {
  userId: string;
  name: string;
  email: string;
  authVersion: number;
  mustChangePassword: boolean;
  role: "ADMIN" | "SUPER_ADMIN" | "MANAGER" | "STAFF";
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

function adminPrincipal() {
  return principalFor(adminId, "ADMIN", `${run}-admin@example.test`);
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
  // SUPER_ADMIN 행은 일반 경로로 만들 수 없으므로, 이미 존재하는 최고관리자를 가정하는
  // 픽스처로 직접 삽입한다 (제품 경로 우회가 아니다).
  await db.user.createMany({
    data: [
      { id: adminId, name: "합성 관리자", email: `${run}-admin@example.test`, password: "synthetic-hash", role: "ADMIN", isActive: true, mustChangePassword: false, authVersion: 1 },
      { id: admin2Id, name: "합성 관리자2", email: `${run}-admin2@example.test`, password: "synthetic-hash", role: "ADMIN", isActive: true, mustChangePassword: false, authVersion: 1 },
      { id: managerId, name: "합성 매니저", email: `${run}-manager@example.test`, password: "synthetic-hash", role: "MANAGER", isActive: true, mustChangePassword: false, authVersion: 1 },
      { id: superId, name: "합성 최고관리자", email: `${run}-super@example.test`, password: "synthetic-hash", role: "SUPER_ADMIN", isActive: true, mustChangePassword: false, authVersion: 1 },
      { id: staffId, name: "합성 직원", email: `${run}-staff@example.test`, password: "synthetic-hash", role: "STAFF", isActive: true, mustChangePassword: false, authVersion: 1 },
    ],
  });
}, 30000);

afterAll(async () => {
  // 이 run의 합성 기록만, FK 순서대로 정리한다. reset·migration·공유 정리는 하지 않는다.
  await db.userAccountChange.deleteMany({
    where: { OR: [{ targetUserId: { in: allIds } }, { actorAdminId: { in: allIds } }] },
  });
  await db.user.deleteMany({ where: { id: { in: allIds } } });
  await db.$disconnect();
}, 30000);

describe.sequential("P1 account API bypass defense (isolated PostgreSQL)", () => {
  it("rejects SUPER_ADMIN creation through the general path (validation layer, core, and DB)", async () => {
    const forgedEmail = `${run}-forged-super@example.test`;
    sessionHolder.userId = adminId;
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
        temporaryPassword: "synthetic-pass-123",
      }),
    );
    expect(actionResult.errors?.role).toBeDefined();
    expect(await db.user.findUnique({ where: { email: forgedEmail } })).toBeNull();
    expect(
      await db.userAccountChange.count({ where: { nextEmail: forgedEmail } }),
    ).toBe(0);

    // (b) 코어 직접 호출 (검증 우회 시도): 쓰기 전에 SUPER_ADMIN_FORBIDDEN으로 거부된다.
    await expect(
      mutations.createAccountCore(adminPrincipal(), {
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
    sessionHolder.userId = adminId;
    const actions = await freshActions();
    const mutations = await freshMutations();
    const managerBefore = await snapshotUser(managerId);
    const superBefore = await snapshotUser(superId);

    // (a) 코어 직접 호출: MANAGER → SUPER_ADMIN 승격 거부, 행 불변, 감사 불변.
    await expect(
      mutations.updateAccountCore(adminPrincipal(), managerId, {
        name: "합성 매니저",
        email: `${run}-manager@example.test`,
        role: "SUPER_ADMIN",
        teacherId: null,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
    expect(await snapshotUser(managerId)).toEqual(managerBefore);
    expect(await db.userAccountChange.count({ where: { targetUserId: managerId } })).toBe(0);

    // (b) 코어 직접 호출: SUPER_ADMIN 대상 일반 수정(강등 포함) 거부, 행 불변, 감사 불변.
    await expect(
      mutations.updateAccountCore(adminPrincipal(), superId, {
        name: "바뀐 이름",
        email: `${run}-super@example.test`,
        role: "ADMIN",
        teacherId: null,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
    expect(await snapshotUser(superId)).toEqual(superBefore);
    expect(await db.userAccountChange.count({ where: { targetUserId: superId } })).toBe(0);

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
    sessionHolder.userId = adminId;
    const actions = await freshActions();
    const mutations = await freshMutations();
    const superBefore = await snapshotUser(superId);

    // (a) 코어 직접 호출: SUPER_ADMIN 대상 재설정 거부, credential·버전·감사 불변.
    await expect(
      mutations.resetAccountPasswordCore(adminPrincipal(), superId, "synthetic-new-hash"),
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

  it("allows SUPER_ADMIN through financial/operational guards but not account guards", async () => {
    sessionHolder.userId = superId;
    const authorization = await freshAuthorization();
    await expect(authorization.requireOperationalPrincipal()).resolves.toMatchObject({
      role: "SUPER_ADMIN",
    });
    await expect(authorization.requireAdminOrSuperAdminPrincipal()).resolves.toMatchObject({
      role: "SUPER_ADMIN",
    });
    await expect(authorization.requireAdminPrincipal()).rejects.toThrow("NOT_FOUND");
  });

  it("denies STAFF at operational guards (server-guard level; HTTP transport NOT VERIFIED)", async () => {
    // 스텁 원문은 "over real HTTP entry points"였으나, 계정·운영 가드는 HTTP 라우트 표면이
    // 아니라 서버 액션·페이지 가드이므로 이 테스트는 서버 가드 수준까지만 입증한다.
    // HTTP 전송 경유 배선은 이 파일에서 검증하지 않으며 NOT VERIFIED로 남긴다.
    sessionHolder.userId = staffId;
    const authorization = await freshAuthorization();
    const mutations = await freshMutations();
    await expect(authorization.requireOperationalPrincipal()).rejects.toThrow("NOT_FOUND");
    await expect(authorization.requireAdminOrSuperAdminPrincipal()).rejects.toThrow("NOT_FOUND");
    await expect(authorization.requireAdminPrincipal()).rejects.toThrow("NOT_FOUND");

    // STAFF가 코어 행위자가 되어도 assertAdminActor가 ACTOR_NOT_ADMIN으로 거부한다.
    const forgedEmail = `${run}-forged-staff@example.test`;
    await expect(
      mutations.createAccountCore(staffPrincipal(), {
        name: "위조 계정",
        email: forgedEmail,
        role: "STAFF",
        teacherId: null,
        isActive: true,
        passwordHash: "synthetic-hash",
      }),
    ).rejects.toMatchObject({ code: "ACTOR_NOT_ADMIN" });
    expect(await db.user.findUnique({ where: { email: forgedEmail } })).toBeNull();
  });

  it("preserves existing ADMIN operational authority (guards pass; general creation still works)", async () => {
    sessionHolder.userId = adminId;
    const authorization = await freshAuthorization();
    const mutations = await freshMutations();
    await expect(authorization.requireOperationalPrincipal()).resolves.toMatchObject({
      role: "ADMIN",
    });
    await expect(authorization.requireAdminOrSuperAdminPrincipal()).resolves.toMatchObject({
      role: "ADMIN",
    });
    await expect(authorization.requireAdminPrincipal()).resolves.toMatchObject({
      role: "ADMIN",
    });

    // ADMIN 행위자의 정상 생성은 여전히 동작하고 감사 행이 남는다.
    const created = await mutations.createAccountCore(adminPrincipal(), {
      name: "합성 신규 직원",
      email: `${run}-new-staff@example.test`,
      role: "STAFF",
      teacherId: null,
      isActive: true,
      passwordHash: "synthetic-hash",
    });
    const row = await db.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.role).toBe("STAFF");
    expect(
      await db.userAccountChange.count({
        where: { targetUserId: created.id, type: "CREATED", actorAdminId: adminId },
      }),
    ).toBe(1);
    // 이 테스트에서 만든 행도 afterAll 정리 대상에 포함한다.
    allIds.push(created.id);
  });
});
