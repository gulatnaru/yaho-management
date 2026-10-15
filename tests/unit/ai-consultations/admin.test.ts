import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assertAdmin,
  readConsultation,
  updatePublication,
  updateGuidance,
} from "@/server/ai-consultations/admin";
import { claim } from "@/server/ai-consultations/ledger";
import { scope, skill, keys, limits, memoryClient } from "./fixtures";
import { RETENTION_MS } from "@/lib/ai-consultations/contracts";
const admin = { userId: "synthetic-admin", role: "ADMIN", active: true };
describe("AC21-08 direct server boundary", () => {
  it.each(["MANAGER", "TEACHER"])(
    "denies %s on queries and mutations before DB use",
    async (role) => {
      const db = memoryClient();
      const actor = { ...admin, role };
      expect(() => assertAdmin(actor)).toThrow();
      await expect(
        readConsultation(db.client, scope, actor, keys, "bad"),
      ).rejects.toThrow();
      await expect(
        updatePublication(db.client, scope, actor, {}),
      ).rejects.toThrow();
      await expect(
        updateGuidance(db.client, scope, actor, {}),
      ).rejects.toThrow();
      expect(db.queries).toBe(0);
    },
  );
  it("refuses inactive ADMIN", () =>
    expect(() => assertAdmin({ ...admin, active: false })).toThrow());
  it("unowned publication id cannot mutate any existing program", async () => {
    const db = memoryClient();
    await expect(
      updatePublication(db.client, scope, admin, {
        kind: "PROGRAM",
        id: "foreign-program",
        enabled: true,
        expectedVersion: 0,
      }),
    ).rejects.toThrow();
    expect(db.queries).toBe(0);
  });
  it("read returns decrypted current owned synthetic raw only; wrong id/expired fail", async () => {
    const db = memoryClient();
    const first = await claim(
      db.client,
      scope,
      skill(),
      keys,
      limits,
      new Date(),
    );
    if (first.kind !== "NEW") throw new Error("NEW expected");
    expect(
      (await readConsultation(db.client, scope, admin, keys, first.row.id))
        .question,
    ).toContain("SYNTHETIC");
    await expect(
      readConsultation(
        db.client,
        scope,
        admin,
        keys,
        "00000000-0000-4000-8000-000000000000",
      ),
    ).rejects.toThrow();
    await expect(
      readConsultation(
        db.client,
        scope,
        admin,
        keys,
        first.row.id,
        () => new Date(first.row.createdAt.getTime() + RETENTION_MS),
      ),
    ).rejects.toThrow();
  });
});
// Exercise actual context/actions, including framework authorization control-flow.
const stubs = vi.hoisted(() => ({
  headers: vi.fn(),
  principal: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: stubs.headers }));
vi.mock("@/lib/auth/authorization", () => ({
  requireAdminPrincipal: stubs.principal,
}));
vi.mock("next/cache", () => ({ revalidatePath: stubs.revalidate }));
vi.mock("@/lib/db/prisma", async () => ({
  prisma: (await import("./fixtures")).memoryClient().client,
}));
describe("actual ADMIN context/action authorization", () => {
  beforeEach(async () => {
    const { environment, proof } = await import("./fixtures");
    for (const [k, v] of Object.entries(environment())) vi.stubEnv(k, v);
    stubs.headers.mockResolvedValue(
      new Headers({ "x-yaho-ai-mock-proof": proof("", "AI_ADMIN") }),
    );
    stubs.principal.mockReset();
    stubs.revalidate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each(["MANAGER", "TEACHER"])(
    "preserves direct-action authorization denial for %s",
    async (role) => {
      stubs.principal.mockRejectedValue(
        new Error("NEXT_HTTP_ERROR_FALLBACK;404:" + role),
      );
      const { savePublication, retryRetention } = await import(
        "@/app/(admin)/ai-consultations/actions"
      );
      await expect(savePublication(new FormData())).rejects.toThrow("404");
      await expect(retryRetention()).rejects.toThrow("404");
      expect(stubs.revalidate).not.toHaveBeenCalled();
    },
  );
  it("cannot activate with no owned capability even for ADMIN", async () => {
    stubs.headers.mockResolvedValue(new Headers());
    stubs.principal.mockResolvedValue({
      userId: "synthetic-admin",
      role: "ADMIN",
    });
    const { adminContext } = await import(
      "@/server/ai-consultations/admin-context"
    );
    await expect(adminContext()).rejects.toThrow("AI_REQUEST_DENIED");
  });
  it("Production refuses before headers/principal lookup in actions", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    stubs.headers.mockClear();
    const { retryRetention } = await import(
      "@/app/(admin)/ai-consultations/actions"
    );
    await expect(retryRetention()).rejects.toThrow();
    expect(stubs.headers).not.toHaveBeenCalled();
    expect(stubs.principal).not.toHaveBeenCalled();
  });
});

it("ADMIN opt-in is explicit and stale simultaneous writes cannot override a newer version", async () => {
  const db = memoryClient();
  let row: {
    runId: string;
    programId: string;
    enabled: boolean;
    version: number;
    updatedById: string;
  } | null = null;
  const upsert = vi.fn(
    async (args: {
      create: typeof row;
      update: { enabled: boolean; updatedById: string };
    }) => {
      row = row
        ? { ...row, ...args.update, version: row.version + 1 }
        : ({ ...args.create, version: 1 } as NonNullable<typeof row>);
      return row;
    },
  );
  Object.assign(db.client, {
    aiProgramPublication: { findUnique: vi.fn(async () => row), upsert },
  });
  await updatePublication(
    db.client,
    scope,
    { userId: "synthetic-admin", role: "ADMIN", active: true },
    {
      kind: "PROGRAM",
      id: scope.manifest.programIds[0],
      enabled: true,
      expectedVersion: 0,
    },
  );
  expect(upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      create: expect.objectContaining({ enabled: true }),
    }),
  );
  await expect(
    updatePublication(
      db.client,
      scope,
      { userId: "other-admin", role: "ADMIN", active: true },
      {
        kind: "PROGRAM",
        id: scope.manifest.programIds[0],
        enabled: false,
        expectedVersion: 0,
      },
    ),
  ).rejects.toThrow();
  expect(upsert).toHaveBeenCalledTimes(1);
});

it("ADMIN raw record parsing failures expose fixed denial, never decrypted text", async () => {
  const db = memoryClient();
  const result = await claim(
    db.client,
    scope,
    skill(),
    keys,
    limits,
    new Date(),
  );
  if (result.kind !== "NEW") throw new Error("NEW expected");
  const { seal } = await import("@/lib/ai-consultations/crypto");
  db.state.consultations[0].rawCiphertext = seal(keys, result.row, {
    question: "SYNTHETIC_RAW_VALUE",
    unexpected: true,
  }).rawCiphertext;
  await expect(
    readConsultation(
      db.client,
      scope,
      { userId: "synthetic-admin", role: "ADMIN", active: true },
      keys,
      result.row.id,
    ),
  ).rejects.toThrow(/^AI_REQUEST_DENIED$/);
});

it.each(["kind", "topic", "id"])(
  "external ADMIN %s validation never leaks submitted text in errors",
  async (field) => {
    const db = memoryClient();
    const sentinel = "SYNTHETIC_PII_SENTINEL";
    const actor = { userId: "synthetic-admin", role: "ADMIN", active: true };
    const operation =
      field === "kind"
        ? updatePublication(db.client, scope, actor, {
            kind: sentinel,
            id: scope.manifest.programIds[0],
            enabled: true,
            expectedVersion: 0,
          })
        : field === "topic"
          ? updateGuidance(db.client, scope, actor, {
              topic: sentinel,
              approved: true,
              expectedVersion: 0,
            })
          : readConsultation(db.client, scope, actor, keys, sentinel);
    const error = await operation.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("AI_REQUEST_DENIED");
    expect(error).not.toHaveProperty("issues");
    const serialized = JSON.stringify(
      Object.fromEntries(
        Object.getOwnPropertyNames(error).map((name) => [
          name,
          (error as Record<string, unknown>)[name],
        ]),
      ),
    );
    expect(serialized).not.toContain(sentinel);
    expect(db.queries).toBe(0);
  },
);
