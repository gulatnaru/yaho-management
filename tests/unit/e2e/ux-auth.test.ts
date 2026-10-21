import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UxManifest } from "../../e2e/support/ux-manifest";
import { prepareUxAuth } from "../../e2e/support/ux-auth";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  disconnect: vi.fn(),
  loadManifest: vi.fn(),
  chmod: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("@playwright/test", () => ({ chromium: { launch: mocks.launch } }));
vi.mock("@prisma/client", () => ({ PrismaClient: class {
  user = { findUniqueOrThrow: mocks.findUniqueOrThrow };
  $disconnect = mocks.disconnect;
} }));
vi.mock("node:fs/promises", () => ({ chmod: mocks.chmod, writeFile: mocks.writeFile }));
vi.mock("../../e2e/support/ux-capability", () => ({ probeSecureLoopbackCookie: async () => true }));
vi.mock("../../e2e/support/ux-manifest", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../e2e/support/ux-manifest")>(),
  loadUxManifest: mocks.loadManifest,
}));

const manifestPath = "test-results/ux-runtime/manifest.json";
const roles = ["ADMIN", "MANAGER", "TEACHER"] as const;
type Role = typeof roles[number];

function account(role: Role) {
  return { role, email: `${role.toLowerCase()}@example.test`, password: "Synthetic-initial-123!", finalPassword: role === "ADMIN" ? "Synthetic-initial-123!" : "Synthetic-final-456!" };
}

// Model the app's two navigations separately: loginAction sends every role to
// /dashboard, then the protected route redirects accounts needing a change.
function browserAccount(role: Role, options: { enforceChange?: boolean; finalDashboard?: boolean } = {}) {
  const data = account(role);
  let pathname = "/login";
  let passwordChanged = false;
  const fields = new Map<string, string>();
  const events: string[] = [];
  const page = {
    setDefaultTimeout: vi.fn(),
    goto: vi.fn(async (path: string) => { events.push(`goto:${path}`); pathname = path; fields.clear(); }),
    url: () => `http://127.0.0.1:3000${pathname}`,
    getByLabel: (label: string) => ({ fill: async (value: string) => { fields.set(label, value); } }),
    getByRole: (_kind: string, { name }: { name: string }) => ({ click: async () => {
      events.push(`submit:${name}`);
      if (name === "로그인") {
        expect(fields.get("이메일")).toBe(data.email);
        expect(fields.get("비밀번호")).toBe(passwordChanged ? data.finalPassword : data.password);
        pathname = passwordChanged && options.finalDashboard === false ? "/account/password" : "/dashboard";
      } else {
        expect(name).toBe("비밀번호 변경");
        expect(pathname).toBe("/account/password");
        expect(fields.get("현재 비밀번호")).toBe(data.password);
        expect(fields.get("새 비밀번호")).toBe(data.finalPassword);
        expect(fields.get("새 비밀번호 확인")).toBe(data.finalPassword);
        passwordChanged = true;
        pathname = "/login"; // The real password action signs the session out.
      }
    } }),
    waitForURL: vi.fn(async (matcher: string | ((url: URL) => boolean), waitOptions?: { timeout?: number }) => {
      const matches = () => typeof matcher === "string" ? matcher === `**${pathname}` : matcher(new URL(page.url()));
      if (!matches() && pathname === "/dashboard" && role !== "ADMIN" && !passwordChanged) {
        expect(waitOptions?.timeout).toBeGreaterThan(0);
        expect(waitOptions?.timeout).toBeLessThanOrEqual(30000);
        if (options.enforceChange !== false) pathname = "/account/password";
      }
      if (!matches()) throw new Error("synthetic navigation timeout");
      events.push(`arrived:${pathname}`);
    }),
  };
  return {
    role, page, events,
    newPage: vi.fn(async () => page),
    storageState: vi.fn(async () => { events.push("storageState"); }),
    close: vi.fn(),
  };
}

function setup(options: Partial<Record<Role, Parameters<typeof browserAccount>[1]>> = {}) {
  const manifest: UxManifest = {
    project: "desktop-chromium",
    environment: Object.fromEntries(roles.map((role) => [`UX_${role}_STORAGE_STATE`, `test-results/ux-runtime/${role.toLowerCase()}.json`])),
    accounts: roles.map(account),
  };
  const contexts = roles.map((role) => browserAccount(role, options[role]));
  const browser = { newContext: vi.fn(), close: vi.fn() };
  for (const context of contexts) browser.newContext.mockResolvedValueOnce(context);
  mocks.launch.mockResolvedValue(browser);
  mocks.loadManifest.mockReturnValue(manifest);
  mocks.findUniqueOrThrow.mockImplementation(async ({ where }: { where: { email: string } }) => {
    const row = manifest.accounts.find((item) => item.email === where.email)!;
    const context = contexts.find((item) => item.role === row.role)!;
    expect(context.events.at(-1)).toBe("arrived:/dashboard");
    return { role: row.role, mustChangePassword: false, isActive: true, teacherId: row.role === "TEACHER" ? "synthetic-teacher" : null };
  });
  return { contexts, browser };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://yaho_e2e:synthetic@127.0.0.1:55432/yaho_e2e");
  vi.stubEnv("DIRECT_URL", process.env.DATABASE_URL);
  vi.stubEnv("PLAYWRIGHT_BASE_URL", "http://127.0.0.1:3000");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("UX real-auth setup terminal navigation", () => {
  it("waits through the intermediate dashboard for both forced roles, then changes password, signs out and logs in again before saving", async () => {
    const { contexts, browser } = setup();
    await prepareUxAuth(manifestPath);
    expect(contexts[0].events).toEqual(["goto:/login", "submit:로그인", "arrived:/dashboard", "storageState"]);
    for (const context of contexts.slice(1)) {
      expect(context.events).toEqual([
        "goto:/login", "submit:로그인", "arrived:/account/password", "submit:비밀번호 변경", "arrived:/login",
        "goto:/login", "submit:로그인", "arrived:/dashboard", "storageState",
      ]);
      expect(context.page.goto).toHaveBeenCalledTimes(2);
      expect(context.storageState).toHaveBeenCalledOnce();
    }
    expect(mocks.chmod).toHaveBeenCalledTimes(3);
    expect(mocks.writeFile).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it.each(["MANAGER", "TEACHER"] as const)("rejects %s if dashboard never enforces a password change without submitting or saving that account", async (role) => {
    const { contexts, browser } = setup({ [role]: { enforceChange: false } });
    await expect(prepareUxAuth(manifestPath)).rejects.toThrow("UX_PASSWORD_POLICY_NOT_ENFORCED");
    const context = contexts.find((item) => item.role === role)!;
    expect(context.events).toEqual(["goto:/login", "submit:로그인"]);
    expect(context.storageState).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it("rejects a final login that returns to the password page instead of dashboard", async () => {
    const { contexts } = setup({ MANAGER: { finalDashboard: false } });
    await expect(prepareUxAuth(manifestPath)).rejects.toThrow("UX_REAL_LOGIN_FAILED");
    expect(contexts[1].storageState).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
