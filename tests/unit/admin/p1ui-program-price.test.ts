/**
 * P1-UI U-03/U-04 — 프로그램 기본 가격: SUPER_ADMIN은 ADMIN과 동일하게
 * 가격을 제출·저장할 수 있고 조용한 누락이 생기지 않으며, 가격 키 생략 시
 * 기존 가격이 유지되고, MANAGER 제출 시 가격은 미반영 상태로 남는다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const programRequireMock = vi.fn();
const programCreateMock = vi.fn();
const programUpdateMock = vi.fn();

vi.mock("@/lib/auth/authorization", () => ({
  requireOperationalPrincipal: (...args: unknown[]) => programRequireMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    program: {
      create: (...args: unknown[]) => programCreateMock(...args),
      update: (...args: unknown[]) => programUpdateMock(...args),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

const { createProgram, updateProgram } = await import("@/app/(admin)/programs/actions");

function programFormData(values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

describe("U-03/U-04 program default price (server validation)", () => {
  beforeEach(() => {
    programRequireMock.mockReset();
    programCreateMock.mockReset();
    programCreateMock.mockResolvedValue({ id: "program-1" });
    programUpdateMock.mockReset();
    programUpdateMock.mockResolvedValue({});
  });

  it("SUPER_ADMIN create with a price persists it, no silent drop (U-03)", async () => {
    programRequireMock.mockResolvedValue({ role: "SUPER_ADMIN" });

    await expect(
      createProgram({}, programFormData({ name: "발레 A반", defaultPrice: "50000" })),
    ).rejects.toThrow("REDIRECT");

    expect(programCreateMock).toHaveBeenCalledTimes(1);
    expect(programCreateMock.mock.calls[0]![0].data.defaultPrice).toBe(50_000);
  });

  it("ADMIN create with a price persists it unchanged (U-03 regression)", async () => {
    programRequireMock.mockResolvedValue({ role: "ADMIN" });

    await expect(
      createProgram({}, programFormData({ name: "발레 A반", defaultPrice: "50000" })),
    ).rejects.toThrow("REDIRECT");

    expect(programCreateMock.mock.calls[0]![0].data.defaultPrice).toBe(50_000);
  });

  it("MANAGER create with a price drops the price key (U-03, existing silent-drop preserved)", async () => {
    programRequireMock.mockResolvedValue({ role: "MANAGER" });

    await expect(
      createProgram({}, programFormData({ name: "발레 A반", defaultPrice: "50000" })),
    ).rejects.toThrow("REDIRECT");

    expect(programCreateMock.mock.calls[0]![0].data).not.toHaveProperty("defaultPrice");
  });

  it("SUPER_ADMIN update with a changed price persists it (U-04)", async () => {
    programRequireMock.mockResolvedValue({ role: "SUPER_ADMIN" });

    await expect(
      updateProgram("program-1", {}, programFormData({ name: "발레 A반", defaultPrice: "60000" })),
    ).rejects.toThrow("REDIRECT");

    expect(programUpdateMock).toHaveBeenCalledTimes(1);
    expect(programUpdateMock.mock.calls[0]![0].data.defaultPrice).toBe(60_000);
  });

  it("SUPER_ADMIN update without a price key preserves the existing price (U-04)", async () => {
    programRequireMock.mockResolvedValue({ role: "SUPER_ADMIN" });

    await expect(
      updateProgram("program-1", {}, programFormData({ name: "발레 A반" })),
    ).rejects.toThrow("REDIRECT");

    expect(programUpdateMock.mock.calls[0]![0].data).not.toHaveProperty("defaultPrice");
  });

  it("ADMIN update without a price key also preserves the existing price (U-04)", async () => {
    programRequireMock.mockResolvedValue({ role: "ADMIN" });

    await expect(
      updateProgram("program-1", {}, programFormData({ name: "발레 A반" })),
    ).rejects.toThrow("REDIRECT");

    expect(programUpdateMock.mock.calls[0]![0].data).not.toHaveProperty("defaultPrice");
  });

  it("SUPER_ADMIN update with a cleared price field writes 0 (U-04, form always submits the key)", async () => {
    programRequireMock.mockResolvedValue({ role: "SUPER_ADMIN" });

    await expect(
      updateProgram("program-1", {}, programFormData({ name: "발레 A반", defaultPrice: "" })),
    ).rejects.toThrow("REDIRECT");

    expect(programUpdateMock.mock.calls[0]![0].data.defaultPrice).toBe(0);
  });

  it("MANAGER update with a price drops the price key (U-04)", async () => {
    programRequireMock.mockResolvedValue({ role: "MANAGER" });

    await expect(
      updateProgram("program-1", {}, programFormData({ name: "발레 A반", defaultPrice: "60000" })),
    ).rejects.toThrow("REDIRECT");

    expect(programUpdateMock.mock.calls[0]![0].data).not.toHaveProperty("defaultPrice");
  });

  it("guard denial rejects before any write", async () => {
    programRequireMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(createProgram({}, programFormData({ name: "발레 A반" }))).rejects.toThrow("UNAUTHORIZED");
    expect(programCreateMock).not.toHaveBeenCalled();
  });
});
