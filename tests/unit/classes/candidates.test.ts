import { beforeEach, describe, expect, it, vi } from "vitest";

const programFindManyMock = vi.fn();
const programFindUniqueMock = vi.fn();
const teacherFindManyMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    program: {
      findMany: (...args: unknown[]) => programFindManyMock(...args),
      findUnique: (...args: unknown[]) => programFindUniqueMock(...args),
    },
    teacher: {
      findMany: (...args: unknown[]) => teacherFindManyMock(...args),
    },
  },
}));

const { listProgramCandidates, listTeacherCandidates } = await import("@/lib/classes/candidates");

describe("listProgramCandidates", () => {
  beforeEach(() => {
    programFindManyMock.mockReset();
    programFindUniqueMock.mockReset();
  });

  it("excludes inactive programs from creation candidates when no currentProgramId is given", async () => {
    programFindManyMock.mockResolvedValue([{ id: "p-active", name: "발레 A반" }]);

    const result = await listProgramCandidates();

    expect(result).toEqual([{ id: "p-active", name: "발레 A반" }]);
    expect(programFindUniqueMock).not.toHaveBeenCalled();
    expect(programFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "ACTIVE" } }),
    );
  });

  it("includes the current program in edit candidates even if it is inactive", async () => {
    programFindManyMock.mockResolvedValue([{ id: "p-active", name: "발레 A반" }]);
    programFindUniqueMock.mockResolvedValue({ id: "p-inactive", name: "요가 B반" });

    const result = await listProgramCandidates("p-inactive");

    expect(result).toEqual(
      expect.arrayContaining([
        { id: "p-active", name: "발레 A반" },
        { id: "p-inactive", name: "요가 B반" },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it("does not re-query when the current program is already active", async () => {
    programFindManyMock.mockResolvedValue([{ id: "p-active", name: "발레 A반" }]);

    const result = await listProgramCandidates("p-active");

    expect(result).toEqual([{ id: "p-active", name: "발레 A반" }]);
    expect(programFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("listTeacherCandidates", () => {
  beforeEach(() => {
    teacherFindManyMock.mockReset();
  });

  it("excludes inactive teachers from creation candidates when no currentTeacherIds are given", async () => {
    teacherFindManyMock.mockResolvedValue([{ id: "t-active", name: "김선생" }]);

    const result = await listTeacherCandidates();

    expect(result).toEqual([{ id: "t-active", name: "김선생" }]);
    expect(teacherFindManyMock).toHaveBeenCalledTimes(1);
  });

  it("includes currently assigned inactive teachers in edit candidates", async () => {
    teacherFindManyMock
      .mockResolvedValueOnce([{ id: "t-active", name: "김선생" }])
      .mockResolvedValueOnce([{ id: "t-inactive", name: "박선생" }]);

    const result = await listTeacherCandidates(["t-active", "t-inactive"]);

    expect(result).toEqual(
      expect.arrayContaining([
        { id: "t-active", name: "김선생" },
        { id: "t-inactive", name: "박선생" },
      ]),
    );
    expect(result).toHaveLength(2);
  });
});
