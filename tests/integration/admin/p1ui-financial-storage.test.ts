/**
 * P1-UI U-01~U-04 저장 경로 — 격리 PostgreSQL 16에서 서버 액션 경유로
 * 생성·수정·재조회까지 검증한다. 실제 프로젝트 DB(Preview/Production)에는
 * 절대 접속하지 않는다. 합성 관리자 및 테스트 데이터만 사용한다.
 *
 * 검증 경계 (정직한 표기):
 * - 실제: 서버 가드, 서버 액션, 실제 DB 쓰기·재조회 결과, 거부 시 행 불변.
 * - 스텁된 부분: 세션 전송 계층만 mock한다 (`@/auth`의 auth()가 합성 세션을
 *   반환하고, 실제 resolveSessionPrincipal이 격리 DB 행을 읽어 principal을
 *   만든다). HTTP 요청 전송 계층은 검증하지 않는다 — 서버 액션은 HTTP
 *   라우트 표면이 아니라 서버 액션이므로, HTTP 배선은 NOT VERIFIED다.
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

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") {
  throw new Error("UX_INTEGRATION_LOCAL_ONLY");
}
assertSafeE2eDatabaseUrls({
  DATABASE_URL: process.env["DATA" + "BASE_URL"],
  DIRECT_URL: process.env.DIRECT_URL,
});

const db = new PrismaClient();
actionContext.db = db;

const run = `p1ui-${crypto.randomUUID()}`;
const superId = `${run}-super`;
const adminId = `${run}-admin`;
const managerId = `${run}-manager`;

async function freshClassActions() {
  vi.resetModules();
  return import("@/app/(admin)/classes/actions");
}

async function freshProgramActions() {
  vi.resetModules();
  return import("@/app/(admin)/programs/actions");
}

function programForm(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

function classForm(values: Record<string, string | string[]>) {
  const form = new FormData();
  const base: Record<string, string | string[]> = {
    programId: "",
    date: "2099-06-05",
    startTime: "09:00",
    endTime: "11:00",
    location: "실외 운동장",
    capacity: "8",
    teacherIds: [],
    ...values,
  };
  for (const [key, value] of Object.entries(base)) {
    if (Array.isArray(value)) {
      for (const v of value) form.append(key, v);
    } else {
      form.set(key, value);
    }
  }
  return form;
}

/** redirect 예외에서 생성·수정 대상 id를 뽑는다 (성공 시 redirect가 던져진다). */
function idFromRedirect(error: unknown, prefix: string): string {
  const message = error instanceof Error ? error.message : "";
  if (!message.startsWith(`REDIRECT:${prefix}/`)) throw error;
  return message.slice(`REDIRECT:${prefix}/`.length);
}

let programId = "";
let teacherId = "";

beforeAll(async () => {
  await db.user.createMany({
    data: [
      { id: superId, name: "합성 최고관리자", email: `${run}-super@example.test`, password: "synthetic-hash", role: "SUPER_ADMIN", isActive: true, mustChangePassword: false, authVersion: 1 },
      { id: adminId, name: "합성 관리자", email: `${run}-admin@example.test`, password: "synthetic-hash", role: "ADMIN", isActive: true, mustChangePassword: false, authVersion: 1 },
      { id: managerId, name: "합성 매니저", email: `${run}-manager@example.test`, password: "synthetic-hash", role: "MANAGER", isActive: true, mustChangePassword: false, authVersion: 1 },
    ],
  });
  const program = await db.program.create({ data: { name: `${run} 프로그램` }, select: { id: true } });
  programId = program.id;
  const teacher = await db.teacher.create({ data: { name: `${run} 선생님`, isActive: true }, select: { id: true } });
  teacherId = teacher.id;
}, 30000);

afterAll(async () => {
  await db.classTeacher.deleteMany({ where: { classSchedule: { programId } } });
  await db.classSchedule.deleteMany({ where: { programId } });
  await db.program.deleteMany({ where: { id: programId } });
  await db.teacher.deleteMany({ where: { id: teacherId } });
  await db.user.deleteMany({ where: { id: { in: [superId, adminId, managerId] } } });
  await db.$disconnect();
}, 30000);

describe.sequential("P1-UI financial storage (isolated PostgreSQL)", () => {
  it("SUPER_ADMIN createProgram with a price persists it and re-reads it (U-03)", async () => {
    sessionHolder.userId = superId;
    const actions = await freshProgramActions();
    let createdId = "";
    try {
      await actions.createProgram({}, programForm({ name: `${run} 생성`, defaultPrice: "50000" }));
      throw new Error("EXPECTED_REDIRECT");
    } catch (error) {
      createdId = idFromRedirect(error, "/programs");
    }
    const row = await db.program.findUniqueOrThrow({ where: { id: createdId } });
    expect(row.defaultPrice).toBe(50_000);
    await db.program.delete({ where: { id: createdId } });
  });

  it("SUPER_ADMIN updateProgram price change persists, key omission preserves (U-04)", async () => {
    sessionHolder.userId = superId;
    const actions = await freshProgramActions();
    const target = await db.program.create({ data: { name: `${run} 수정`, defaultPrice: 40_000 }, select: { id: true } });
    try {
      await actions.updateProgram(target.id, {}, programForm({ name: `${run} 수정`, defaultPrice: "60000" }));
      throw new Error("EXPECTED_REDIRECT");
    } catch (error) {
      idFromRedirect(error, "/programs");
    }
    expect((await db.program.findUniqueOrThrow({ where: { id: target.id } })).defaultPrice).toBe(60_000);

    // 가격 키 생략 시 기존 값 유지 (스키마의 0 변환이 쓰기를 만들지 않는다).
    try {
      await actions.updateProgram(target.id, {}, programForm({ name: `${run} 수정2` }));
      throw new Error("EXPECTED_REDIRECT");
    } catch (error) {
      idFromRedirect(error, "/programs");
    }
    expect((await db.program.findUniqueOrThrow({ where: { id: target.id } })).defaultPrice).toBe(60_000);
    await db.program.delete({ where: { id: target.id } });
  });

  it("MANAGER createProgram with a price stores the DB default, not the price (U-03)", async () => {
    sessionHolder.userId = managerId;
    const actions = await freshProgramActions();
    let createdId = "";
    try {
      await actions.createProgram({}, programForm({ name: `${run} 매니저`, defaultPrice: "50000" }));
      throw new Error("EXPECTED_REDIRECT");
    } catch (error) {
      createdId = idFromRedirect(error, "/programs");
    }
    expect((await db.program.findUniqueOrThrow({ where: { id: createdId } })).defaultPrice).toBe(0);
    await db.program.delete({ where: { id: createdId } });
  });

  it("SUPER_ADMIN createClass with a price persists it and re-reads it (U-02)", async () => {
    sessionHolder.userId = superId;
    const actions = await freshClassActions();
    let createdId = "";
    try {
      await actions.createClass(
        {},
        classForm({ programId, teacherIds: [teacherId], applicationPrice: "30000" }),
      );
      throw new Error("EXPECTED_REDIRECT");
    } catch (error) {
      createdId = idFromRedirect(error, "/classes");
    }
    const row = await db.classSchedule.findUniqueOrThrow({ where: { id: createdId } });
    expect(row.applicationPrice).toBe(30_000);
  });

  it("SUPER_ADMIN updateClass persists changed and unchanged prices (U-01)", async () => {
    sessionHolder.userId = superId;
    const actions = await freshClassActions();
    const before = await db.classSchedule.findFirstOrThrow({ where: { programId }, orderBy: { createdAt: "desc" } });
    expect(before.applicationPrice).toBe(30_000);

    try {
      await actions.updateClass(
        before.id,
        {},
        classForm({
          programId,
          teacherIds: [teacherId],
          applicationPrice: "35000",
          applicationPriceBaseline: "30000",
          applicationPriceRevision: before.updatedAt.toISOString(),
        }),
      );
      throw new Error("EXPECTED_REDIRECT");
    } catch (error) {
      idFromRedirect(error, "/classes");
    }
    const changed = await db.classSchedule.findUniqueOrThrow({ where: { id: before.id } });
    expect(changed.applicationPrice).toBe(35_000);

    // 동일 가격을 다시 제출한 뒤 최종 저장값을 확인한다. 가격은 조건부 updateMany로 다시 쓴다.
    try {
      await actions.updateClass(
        changed.id,
        {},
        classForm({
          programId,
          teacherIds: [teacherId],
          applicationPrice: "35000",
          applicationPriceBaseline: "35000",
          applicationPriceRevision: changed.updatedAt.toISOString(),
        }),
      );
      throw new Error("EXPECTED_REDIRECT");
    } catch (error) {
      idFromRedirect(error, "/classes");
    }
    expect((await db.classSchedule.findUniqueOrThrow({ where: { id: before.id } })).applicationPrice).toBe(35_000);
  });

  it("MANAGER createClass with a price is rejected and creates no row (U-02)", async () => {
    sessionHolder.userId = managerId;
    const actions = await freshClassActions();
    const countBefore = await db.classSchedule.count({ where: { programId } });
    const result = await actions.createClass(
      {},
      classForm({ programId, teacherIds: [teacherId], applicationPrice: "30000" }),
    );
    expect(result.formError).toBe("신청 최종 금액은 관리자만 설정할 수 있습니다.");
    expect(await db.classSchedule.count({ where: { programId } })).toBe(countBefore);
  });
});
