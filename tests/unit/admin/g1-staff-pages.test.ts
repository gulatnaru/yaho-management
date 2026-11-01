import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const principal = vi.fn();
const dashboardClasses = vi.fn();
const monthly = vi.fn();
const cancellations = vi.fn();
const financial = vi.fn();
const listClasses = vi.fn();
const teacherLookup = vi.fn();
const teacherCount = vi.fn();

vi.mock("@/lib/auth/authorization", () => ({ requireCurrentPrincipal: () => principal() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/dashboard/queries", () => ({
  getDashboardClasses: (...args: unknown[]) => dashboardClasses(...args),
  getMonthlyCalendarMetrics: (...args: unknown[]) => monthly(...args),
  getTodayCancellationCount: (...args: unknown[]) => cancellations(...args),
  getTodayFinancialMetrics: (...args: unknown[]) => financial(...args),
}));
vi.mock("@/lib/classes/queries", () => ({ listClasses: (...args: unknown[]) => listClasses(...args) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { teacher: { findUnique: (...args: unknown[]) => teacherLookup(...args) } } }));
vi.mock("@/lib/teachers/deactivation-warning", () => ({ countFutureScheduledAssignments: (...args: unknown[]) => teacherCount(...args) }));

const { default: DashboardPage } = await import("@/app/(admin)/dashboard/page");
const { default: ClassesPage } = await import("@/app/(admin)/classes/page");
const { default: TeacherPage } = await import("@/app/(admin)/teachers/[id]/page");

const base = { userId: "user-1", name: "사용자", email: "user@test.invalid", authVersion: 1, mustChangePassword: false };
function asRole(role: string) {
  return { ...base, role, teacherId: role === "TEACHER" ? "teacher-1" : null };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  dashboardClasses.mockResolvedValue([]);
  monthly.mockResolvedValue({});
  cancellations.mockResolvedValue(0);
  financial.mockResolvedValue({});
  listClasses.mockResolvedValue({ classes: [], total: 0, page: 1, totalPages: 1 });
  teacherLookup.mockResolvedValue({ id: "teacher-1", name: "비밀선생님", phone: "010-1234-5678", memo: "비밀메모", isActive: true });
  teacherCount.mockResolvedValue(0);
});
afterEach(() => vi.unstubAllGlobals());

describe("STAFF page authorization", () => {
  it.each([
    {},
    { date: "2026-10-31", month: "2026-10" },
    { date: "2026-11-01", month: "2026-11" },
    { month: "2027-01" },
  ])("renders only an empty dashboard for %j before any query", async (params) => {
    principal.mockResolvedValue(asRole("STAFF"));
    const html = renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve(params) }));
    expect(html).toContain("관리자 홈");
    for (const marker of ["수업", "예약", "출결", "선생님", "비밀", "href="]) expect(html).not.toContain(marker);
    for (const query of [dashboardClasses, monthly, cancellations, financial]) expect(query).not.toHaveBeenCalled();
  });

  it.each([{}, { status: "all", page: "2", dateFrom: "2026-01-01" }])("denies class list before lookup for %j", async (params) => {
    principal.mockResolvedValue(asRole("STAFF"));
    await expect(ClassesPage({ searchParams: Promise.resolve(params) })).rejects.toThrow("NOT_FOUND");
    expect(listClasses).not.toHaveBeenCalled();
  });

  it("denies an existing teacher id before lookup and warning count", async () => {
    principal.mockResolvedValue(asRole("STAFF"));
    await expect(TeacherPage({ params: Promise.resolve({ id: "teacher-1" }) })).rejects.toThrow("NOT_FOUND");
    expect(teacherLookup).not.toHaveBeenCalled();
    expect(teacherCount).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "MANAGER", "TEACHER", "SUPER_ADMIN"])("preserves %s dashboard, class list and teacher detail", async (role) => {
    const actor = asRole(role);
    principal.mockResolvedValue(actor);
    await DashboardPage({ searchParams: Promise.resolve({ month: "2026-10", date: "2026-10-01" }) });
    expect(monthly).toHaveBeenCalledTimes(1);
    expect(dashboardClasses).toHaveBeenCalled();
    expect(cancellations).toHaveBeenCalledTimes(1);
    expect(financial).toHaveBeenCalledTimes(role === "ADMIN" || role === "SUPER_ADMIN" ? 1 : 0);
    expect(dashboardClasses.mock.calls[0][1]).toBe(role === "TEACHER" ? "teacher-1" : undefined);
    await ClassesPage({ searchParams: Promise.resolve({}) });
    expect(listClasses).toHaveBeenCalledWith(expect.anything(), actor);
    const teacherPage = await TeacherPage({ params: Promise.resolve({ id: "teacher-1" }) });
    expect(teacherLookup).toHaveBeenCalledWith({ where: { id: "teacher-1" } });
    expect(renderToStaticMarkup(teacherPage)).toContain("비밀선생님");
    expect(teacherCount).toHaveBeenCalledTimes(role === "ADMIN" || role === "MANAGER" ? 1 : 0);
  });
});
