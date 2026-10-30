// P3 core contract tests exercise an explicitly enabled isolated harness.
vi.mock("@/lib/invitations/config", () => ({ invitationUseEnabled: () => true }));
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptInvitationCore,
  cancelInvitationCore,
  INVITATION_TTL_MS,
  InvitationError,
  issueInvitationCore,
  reissueInvitationCore,
} from "@/server/accounts/invitations";
import {
  generateApplicationCapabilityToken,
  hashApplicationCapabilityToken,
} from "@/lib/reservation-applications/token";

/**
 * P3 초대 코어 단위 테스트 (mock 트랜잭션 클라이언트).
 * 실제 DB·HTTP·세션 전송은 검증하지 않는다 — 격리 PG 통합·E2E에서 검증한다.
 * 토큰은 실제 capability 패턴으로 생성하고, 해시 대조는 실제 함수로 수행한다.
 */

const CUTOVER_ENV = "YAHO_ADMIN_CUTOVER_MODE";
const originalCutoverMode = process.env[CUTOVER_ENV];

function setMode(mode: string | undefined) {
  if (mode === undefined) delete process.env[CUTOVER_ENV];
  else process.env[CUTOVER_ENV] = mode;
}

type ActorRow = { role: string; isActive: boolean; mustChangePassword: boolean };
type InvitationRow = {
  id: string;
  email: string;
  role: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  issuedById: string;
  targetUserId: string;
  createdAt: Date;
};
type TargetRow = {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  teacherId: string | null;
};

function mockClient(state: {
  actor?: ActorRow | null;
  existingUser?: { id: string; role: string; isActive: boolean } | null;
  invitation?: InvitationRow | null;
  targetUser?: TargetRow | null;
  teacher?: { id: string; isActive: boolean } | null;
  linkedUser?: { id: string } | null;
  openInvitations?: { id: string }[];
  consumedCount?: number;
  activatedCount?: number;
} = {}) {
  const audit: unknown[] = [];
  const createdInvitations: unknown[] = [];
  const tx = {
    $queryRaw: vi.fn(async (sqlArg: unknown) => {
      // 실제 DB의 WHERE 필터를 흉내낸다: id·tokenHash 값과 일치하는 행만 반환한다.
      // (필터를 흉내내지 않으면 어떤 토큰이든 수락되는 가짜 PASS가 된다.)
      const rec = sqlArg as { strings?: string[]; values?: unknown[] };
      const sql = rec?.strings ? rec.strings.join("?") : String(sqlArg);
      const values = rec?.values ?? [];
      if (sql.includes("pg_advisory_xact_lock")) return [];
      if (sql.includes("AdminInvitation")) {
        const inv = state.invitation;
        if (!inv) return [];
        return values.includes(inv.id) || values.includes(inv.tokenHash) ? [inv] : [];
      }
      if (sql.includes('"User"')) {
        const user = state.targetUser;
        if (!user) return [];
        return values.includes(user.id) ? [user] : [];
      }
      return [];
    }),
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id !== undefined) return state.actor ?? null;
        if (where.email !== undefined) return state.existingUser ?? null;
        return null;
      }),
      findFirst: vi.fn(async () => state.linkedUser ?? null),
      create: vi.fn(async () => ({ id: "new-user-1" })),
      updateMany: vi.fn(async () => ({ count: state.activatedCount ?? 1 })),
    },
    adminInvitation: {
      findMany: vi.fn(async () => state.openInvitations ?? []),
      create: vi.fn(async ({ data }: { data: unknown }) => {
        createdInvitations.push(data);
        return { id: "inv-1" };
      }),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: state.consumedCount ?? 1 })),
    },
    userAccountChange: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        audit.push(data);
        return {};
      }),
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        audit.push(...data);
        return {};
      }),
    },
    teacher: {
      findUnique: vi.fn(async () => state.teacher ?? null),
    },
  };
  const client = { $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)) };
  return { tx, client, audit, createdInvitations };
}

const superPrincipal = { userId: "super-1", role: "SUPER_ADMIN", teacherId: null } as never;
const adminPrincipal = { userId: "admin-1", role: "ADMIN", teacherId: null } as never;
const superActor: ActorRow = { role: "SUPER_ADMIN", isActive: true, mustChangePassword: false };
const adminActor: ActorRow = { role: "ADMIN", isActive: true, mustChangePassword: false };

function pendingInvitation(overrides: Partial<InvitationRow> = {}): InvitationRow {
  return {
    id: "inv-1",
    email: "staff@example.test",
    role: "STAFF",
    tokenHash: "deadbeef",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    usedAt: null,
    revokedAt: null,
    issuedById: "super-1",
    targetUserId: "target-1",
    createdAt: new Date(),
    ...overrides,
  };
}

function inactiveTarget(overrides: Partial<TargetRow> = {}): TargetRow {
  return { id: "target-1", email: "staff@example.test", role: "STAFF", isActive: false, teacherId: null, ...overrides };
}

beforeEach(() => {
  setMode("SUPER_ADMIN");
});

afterAll(() => {
  setMode(originalCutoverMode);
});

describe("issueInvitationCore", () => {
  it("신규 계정 초대: 비밀번호 없는 비활성 생성 + 초대 행 + 감사 2건, 토큰은 32바이트 capability", async () => {
    const { client, audit, createdInvitations } = mockClient({ actor: superActor });
    const result = await issueInvitationCore(
      superPrincipal,
      { name: "신규 직원", email: "new@example.test", role: "STAFF", teacherId: null },
      client as never,
    );
    expect(result.targetUserId).toBe("new-user-1");
    expect(result.invitationId).toBe("inv-1");
    // O-2: 32바이트 capability 패턴 (24바이트 link 상수 차용 금지).
    expect(Buffer.from(result.token, "base64url").length).toBe(32);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const created = createdInvitations[0] as { tokenHash: string; expiresAt: Date };
    expect(created.tokenHash).toBe(hashApplicationCapabilityToken(result.token));
    expect(created.tokenHash).not.toBe(result.token);
    expect(created.expiresAt.getTime() - Date.now()).toBeGreaterThan(INVITATION_TTL_MS - 60_000);
    expect(created.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(INVITATION_TTL_MS);
    const types = (audit as { type: string }[]).map((row) => row.type);
    expect(types).toContain("CREATED");
    expect(types).toContain("INVITATION_ISSUED");
    // 원본 토큰은 감사 행 어디에도 없다.
    expect(JSON.stringify(audit)).not.toContain(result.token);
  });

  it("기존 활성 이메일 초대는 거부한다", async () => {
    const { client } = mockClient({
      actor: superActor,
      existingUser: { id: "u-1", role: "STAFF", isActive: true },
    });
    await expect(
      issueInvitationCore(superPrincipal, { name: "x", email: "a@example.test", role: "STAFF", teacherId: null }, client as never),
    ).rejects.toMatchObject({ code: "INVITATION_EMAIL_ACTIVE" });
  });

  it("비활성 재초대: 계정 행 변경 없이 이전 토큰 해지 + 새 토큰 발행", async () => {
    const { client, audit, tx } = mockClient({
      actor: superActor,
      existingUser: { id: "target-1", role: "STAFF", isActive: false },
      openInvitations: [{ id: "old-inv" }],
    });
    const result = await issueInvitationCore(
      superPrincipal,
      { name: "무시되는 이름", email: "staff@example.test", role: "STAFF", teacherId: null },
      client as never,
    );
    expect(result.targetUserId).toBe("target-1");
    expect((tx.user.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    const types = (audit as { type: string }[]).map((row) => row.type);
    expect(types).toContain("INVITATION_REVOKED");
    expect(types).toContain("INVITATION_ISSUED");
    expect(types).not.toContain("CREATED");
  });

  it("비활성 재초대 시 역할 불일치는 거부한다", async () => {
    const { client } = mockClient({
      actor: superActor,
      existingUser: { id: "target-1", role: "STAFF", isActive: false },
    });
    await expect(
      issueInvitationCore(superPrincipal, { name: "x", email: "staff@example.test", role: "MANAGER", teacherId: null }, client as never),
    ).rejects.toMatchObject({ code: "INVITATION_ROLE_MISMATCH" });
  });

  it("일반 초대 경로에서 SUPER_ADMIN 지정은 코어에서 거부된다", async () => {
    const { client } = mockClient({ actor: superActor });
    await expect(
      issueInvitationCore(
        superPrincipal,
        { name: "x", email: "s@example.test", role: "SUPER_ADMIN", teacherId: null } as never,
        client as never,
      ),
    ).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
  });

  it("TEACHER 초대 시 선생님 미선택은 거부된다 (CHECK 우회 없음)", async () => {
    const { client } = mockClient({ actor: superActor });
    await expect(
      issueInvitationCore(superPrincipal, { name: "x", email: "t@example.test", role: "TEACHER", teacherId: null }, client as never),
    ).rejects.toMatchObject({ code: "TEACHER_REQUIRED" });
  });

  it("LEGACY 모드에서도 SUPER_ADMIN 발급은 허용되고, ADMIN 발급은 거부된다", async () => {
    setMode("LEGACY_ADMIN");
    const ok = mockClient({ actor: superActor });
    const result = await issueInvitationCore(
      superPrincipal,
      { name: "x", email: "l@example.test", role: "STAFF", teacherId: null },
      ok.client as never,
    );
    expect(result.targetUserId).toBe("new-user-1");
    const denied = mockClient({ actor: adminActor });
    await expect(
      issueInvitationCore(adminPrincipal, { name: "x", email: "l2@example.test", role: "STAFF", teacherId: null }, denied.client as never),
    ).rejects.toMatchObject({ code: "INVITATION_FORBIDDEN" });
  });

  it("INVALID 모드에서는 SUPER_ADMIN이라도 발급이 차단된다", async () => {
    setMode("BOGUS_MODE");
    const { client } = mockClient({ actor: superActor });
    await expect(
      issueInvitationCore(superPrincipal, { name: "x", email: "i@example.test", role: "STAFF", teacherId: null }, client as never),
    ).rejects.toMatchObject({ code: "INVITATION_MODE_INVALID" });
  });
});

describe("reissueInvitationCore / cancelInvitationCore", () => {
  it("재발급: 이전 토큰 해지 + 새 토큰 발행, 계정 역할·활성 불변", async () => {
    const { client, audit } = mockClient({
      actor: superActor,
      invitation: pendingInvitation(),
      targetUser: inactiveTarget(),
      openInvitations: [{ id: "inv-1" }],
    });
    const result = await reissueInvitationCore(superPrincipal, "inv-1", client as never);
    expect(result.targetUserId).toBe("target-1");
    expect(result.token).not.toBe("");
    const types = (audit as { type: string }[]).map((row) => row.type);
    expect(types).toContain("INVITATION_REVOKED");
    expect(types).toContain("INVITATION_RESENT");
  });

  it("만료된 초대도 재발급할 수 있다", async () => {
    const { client } = mockClient({
      actor: superActor,
      invitation: pendingInvitation({ expiresAt: new Date(Date.now() - 1000) }),
      targetUser: inactiveTarget(),
      openInvitations: [{ id: "inv-1" }],
    });
    const result = await reissueInvitationCore(superPrincipal, "inv-1", client as never);
    expect(result.invitationId).toBe("inv-1");
  });

  it("사용済 초대의 재발급은 거부된다", async () => {
    const { client } = mockClient({
      actor: superActor,
      invitation: pendingInvitation({ usedAt: new Date() }),
      targetUser: inactiveTarget(),
    });
    await expect(reissueInvitationCore(superPrincipal, "inv-1", client as never)).rejects.toMatchObject({
      code: "INVITATION_ALREADY_USED",
    });
  });

  it("해지: 대기 초대를 해지하고 계정 행은 삭제하지 않는다", async () => {
    const { client, audit, tx } = mockClient({
      actor: superActor,
      invitation: pendingInvitation(),
    });
    const result = await cancelInvitationCore(superPrincipal, "inv-1", client as never);
    expect(result.invitationId).toBe("inv-1");
    expect((tx.adminInvitation.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data.revokedAt).toBeInstanceOf(Date);
    expect((audit as { type: string }[]).map((row) => row.type)).toContain("INVITATION_REVOKED");
  });

  it("이미 해지된 초대의 해지는 거부된다", async () => {
    const { client } = mockClient({
      actor: superActor,
      invitation: pendingInvitation({ revokedAt: new Date() }),
    });
    await expect(cancelInvitationCore(superPrincipal, "inv-1", client as never)).rejects.toMatchObject({
      code: "INVITATION_REVOKED",
    });
  });
});

describe("acceptInvitationCore", () => {
  function validAcceptSetup(overrides: {
    invitation?: Partial<InvitationRow>;
    target?: Partial<TargetRow>;
    teacher?: { id: string; isActive: boolean } | null;
    consumedCount?: number;
    activatedCount?: number;
  } = {}) {
    const token = generateApplicationCapabilityToken();
    const invitation = pendingInvitation({ tokenHash: hashApplicationCapabilityToken(token), ...(overrides.invitation ?? {}) });
    const target = inactiveTarget(overrides.target ?? {});
    const { client, audit, tx } = mockClient({
      invitation,
      targetUser: target,
      teacher: overrides.teacher !== undefined ? overrides.teacher : null,
      consumedCount: overrides.consumedCount,
      activatedCount: overrides.activatedCount,
    });
    return { token, client, audit, tx, invitation, target };
  }

  it("정상 수락: 토큰 소비 + 활성화 + authVersion 증가 + INVITATION_ACCEPTED 감사 (행위자=본인)", async () => {
    const { token, client, audit, tx } = validAcceptSetup();
    const result = await acceptInvitationCore({ token, passwordHash: "hashed-pw" }, client as never);
    expect(result.userId).toBe("target-1");
    const updateData = (tx.user.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(updateData.isActive).toBe(true);
    expect(updateData.mustChangePassword).toBe(false);
    expect(updateData.password).toBe("hashed-pw");
    expect(updateData.authVersion).toEqual({ increment: 1 });
    const rows = audit as { type: string; actorAdminId: string; previousIsActive: boolean; nextIsActive: boolean }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("INVITATION_ACCEPTED");
    expect(rows[0].actorAdminId).toBe("target-1");
    expect(rows[0].previousIsActive).toBe(false);
    expect(rows[0].nextIsActive).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it("형식이 맞지 않는 토큰은 DB 조회 없이 무효 처리한다", async () => {
    const { client } = mockClient({});
    await expect(acceptInvitationCore({ token: "bad!!", passwordHash: "x" }, client as never)).rejects.toMatchObject({
      code: "INVITATION_INVALID",
    });
    expect((client.$transaction as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("알 수 없는 토큰 해시는 무효 처리한다 (존재 여부 누출 없음)", async () => {
    const { token, client } = validAcceptSetup({ invitation: undefined as never });
    void token;
    const unknown = generateApplicationCapabilityToken();
    await expect(acceptInvitationCore({ token: unknown, passwordHash: "x" }, client as never)).rejects.toMatchObject({
      code: "INVITATION_INVALID",
    });
  });

  it("만료·해지·사용済 토큰은 각각 거부되고 계정 상태는 변하지 않는다", async () => {
    const expired = validAcceptSetup({ invitation: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptInvitationCore({ token: expired.token, passwordHash: "x" }, expired.client as never)).rejects.toMatchObject({
      code: "INVITATION_EXPIRED",
    });
    const revoked = validAcceptSetup({ invitation: { revokedAt: new Date() } });
    await expect(acceptInvitationCore({ token: revoked.token, passwordHash: "x" }, revoked.client as never)).rejects.toMatchObject({
      code: "INVITATION_REVOKED",
    });
    const used = validAcceptSetup({ invitation: { usedAt: new Date() } });
    await expect(acceptInvitationCore({ token: used.token, passwordHash: "x" }, used.client as never)).rejects.toMatchObject({
      code: "INVITATION_ALREADY_USED",
    });
    for (const setup of [expired, revoked, used]) {
      expect((setup.tx.user.updateMany as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
      expect(setup.audit).toHaveLength(0);
    }
  });

  it("동시 수락 경합에서 조건부 업데이트 count 0이면 실패한다 (최대 1건 성공)", async () => {
    const { token, client } = validAcceptSetup({ consumedCount: 0 });
    await expect(acceptInvitationCore({ token, passwordHash: "x" }, client as never)).rejects.toMatchObject({
      code: "INVITATION_ALREADY_USED",
    });
  });

  it("이미 활성 계정의 초대는 거부된다", async () => {
    const { token, client } = validAcceptSetup({ target: { isActive: true } });
    await expect(acceptInvitationCore({ token, passwordHash: "x" }, client as never)).rejects.toMatchObject({
      code: "INVITATION_TARGET_ACTIVE",
    });
  });

  it("발급 후 이메일이 바뀌면 초대는 무효이다", async () => {
    const { token, client } = validAcceptSetup({ target: { email: "changed@example.test" } });
    await expect(acceptInvitationCore({ token, passwordHash: "x" }, client as never)).rejects.toMatchObject({
      code: "INVITATION_INVALID",
    });
  });

  it("TEACHER 대상은 선생님 연결이 유효해야 수락된다", async () => {
    const bad = validAcceptSetup({
      target: { role: "TEACHER", teacherId: "t-1" },
      teacher: { id: "t-1", isActive: false },
    });
    await expect(acceptInvitationCore({ token: bad.token, passwordHash: "x" }, bad.client as never)).rejects.toMatchObject({
      code: "INVITATION_TEACHER_UNAVAILABLE",
    });
    const good = validAcceptSetup({
      invitation: { role: "TEACHER" },
      target: { role: "TEACHER", teacherId: "t-1" },
      teacher: { id: "t-1", isActive: true },
    });
    const result = await acceptInvitationCore({ token: good.token, passwordHash: "x" }, good.client as never);
    expect(result.userId).toBe("target-1");
  });

  it("INVALID 모드에서는 수락 실행이 차단된다", async () => {
    setMode("BOGUS_MODE");
    const { token, client } = validAcceptSetup();
    await expect(acceptInvitationCore({ token, passwordHash: "x" }, client as never)).rejects.toMatchObject({
      code: "INVITATION_INVALID",
    });
  });

  it("수락 실패 시 감사 행을 쓰지 않는다", async () => {
    const { token, client, audit } = validAcceptSetup({ invitation: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptInvitationCore({ token, passwordHash: "x" }, client as never)).rejects.toThrow(InvitationError);
    expect(audit).toHaveLength(0);
  });
});
