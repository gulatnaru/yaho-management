/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as csrfGET } from "@/app/api/manual-test/csrf/route";
import { POST as bootstrapPOST } from "@/app/api/manual-test/bootstrap/route";
import { getManualTestRuntime } from "@/server/manual-test/runtime";
import { ORIGIN, SYNTHETIC_SECRET, cookiePair } from "./helpers";

describe("manual-test runtime opt-in on Preview", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MANUAL_TEST_DATABASE_URL", undefined);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("MANUAL_TEST_ENABLED", "true");
    vi.stubEnv("MANUAL_TEST_MOCK_ENABLED", undefined);
    vi.stubEnv("MANUAL_TEST_MOCK_ORIGIN", ORIGIN);
    vi.stubEnv("MANUAL_TEST_MOCK_BOOTSTRAP_SECRET", SYNTHETIC_SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "false", "1", "TRUE", ""])("fails closed for MANUAL_TEST_ENABLED=%s, even with the old flag", async (enabled) => {
    vi.stubEnv("MANUAL_TEST_ENABLED", enabled);
    vi.stubEnv("MANUAL_TEST_MOCK_ENABLED", "true");
    expect(() => getManualTestRuntime()).toThrow("MOCK_RUNTIME_DISABLED");
    const response = await csrfGET(new Request(`${ORIGIN}/api/manual-test/csrf`, { headers: { origin: ORIGIN } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "MOCK_RUNTIME_DISABLED" });
  });

  it("executes challenge and authenticated bootstrap in the test-only mock environment", async () => {
    const challengeResponse = await csrfGET(new Request(`${ORIGIN}/api/manual-test/csrf`, { headers: { "sec-fetch-site": "same-origin" } }));
    expect(challengeResponse.status).toBe(200);
    const { csrf } = await challengeResponse.json();
    const response = await bootstrapPOST(new Request(`${ORIGIN}/api/manual-test/bootstrap`, {
      method: "POST",
      headers: {
        origin: ORIGIN, "content-type": "application/json",
        cookie: cookiePair(challengeResponse.headers.get("set-cookie")!), "x-manual-test-csrf": csrf, "x-manual-test-bootstrap-secret": SYNTHETIC_SECRET,
      },
      body: JSON.stringify({}),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "MOCK_ONLY", runId: expect.any(String) });
    expect(response.headers.get("set-cookie")).toContain("__Host-yaho-manual-test-operator=");
  });

  it("retains explicit Vercel production denial even when opted in", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => getManualTestRuntime()).toThrow("MOCK_RUNTIME_DISABLED");
  });

  it("rechecks opt-in after the runtime has been cached", () => {
    expect(getManualTestRuntime().auth).toBeDefined();
    vi.stubEnv("MANUAL_TEST_ENABLED", "false");
    expect(() => getManualTestRuntime()).toThrow("MOCK_RUNTIME_DISABLED");
  });

  it("requires MANUAL_TEST_MOCK_ORIGIN", () => {
    vi.stubEnv("MANUAL_TEST_MOCK_ORIGIN", undefined);
    expect(() => getManualTestRuntime()).toThrow("MOCK_RUNTIME_DISABLED");
  });

  it.each(["http://manual.test", "https://manual.test/path", "https://manual.test/"])("rejects invalid configured origin %s", (origin) => {
    vi.stubEnv("MANUAL_TEST_MOCK_ORIGIN", origin);
    expect(() => getManualTestRuntime()).toThrow();
  });

  it("supports ADMIN mode with no configured synthetic secret", () => {
    vi.stubEnv("MANUAL_TEST_MOCK_BOOTSTRAP_SECRET", undefined);
    expect(getManualTestRuntime().auth).toBeDefined();
  });

  it("rejects an undersized bootstrap secret", () => {
    vi.stubEnv("MANUAL_TEST_MOCK_BOOTSTRAP_SECRET", "short");
    expect(() => getManualTestRuntime()).toThrow();
  });
});

describe("manual-test route exports", () => {
  const routes = import.meta.glob<{ runtime: string; dynamic?: string; GET?: unknown; POST?: unknown }>("../../../app/api/manual-test/*/route.ts", { eager: true });
  const methods = {
    bootstrap: "POST", classes: "POST", cleanup: "POST", close: "POST", confirm: "POST", cancel: "POST", csrf: "GET", deposit: "POST",
    exchange: "POST", links: "POST", payment: "POST", refunds: "POST", revenue: "GET", session: "GET", submission: "POST",
  } as const;

  it("exports all 15 expected route handlers with the Node.js runtime", () => {
    expect(Object.keys(routes)).toHaveLength(15);
    for (const [name, method] of Object.entries(methods)) {
      const route = routes[`../../../app/api/manual-test/${name}/route.ts`];
      expect(route, name).toBeDefined();
      expect(route.runtime, name).toBe("nodejs");
      expect(route[method], `${name} ${method}`).toBeTypeOf("function");
      if (method === "GET") expect(route.dynamic, name).toBe("force-dynamic");
    }
  });
});
