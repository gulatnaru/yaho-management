import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { bootstrapResult, cleanedResult, closedResult, csrfSchema, errorMessage, linkResult, ManualClientError, manualRequest, operatorSession, readReservationLocation, reservationSession, reservationUrl, RetryKeys, revenueSchema, uuid } from "@/app/(manual-test)/manual-test/client";
import { createManualTestGetRoute, createManualTestPostRoute } from "@/server/manual-test/handler";
import * as runtimeModule from "@/server/manual-test/runtime";
import { ORIGIN, START, setup } from "./helpers";

const routes: Record<string, (request: Request) => Promise<Response>> = {
  csrf: createManualTestGetRoute("csrf"), session: createManualTestGetRoute("session"), revenue: createManualTestGetRoute("revenue"),
  ...Object.fromEntries((["bootstrap", "classes", "links", "exchange", "submission", "deposit", "confirm", "cancel", "payment", "refunds", "close", "cleanup"] as const).map((name) => [name, createManualTestPostRoute(name)])),
};

describe("manual TEST browser client against real mock route handlers, no database", () => {
  let context: ReturnType<typeof setup>;
  let cookies: Map<string, string>;
  let loseResponse: string | null;
  let calls: { path: string; method: string; headers: Headers }[];
  beforeEach(() => {
    context = setup({}, async () => true); cookies = new Map(); loseResponse = null; calls = [];
    vi.spyOn(runtimeModule, "getManualTestRuntime").mockReturnValue(context);
    vi.stubGlobal("fetch", vi.fn(async (path: string, options: RequestInit) => {
      const url = new URL(path, ORIGIN);
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname.startsWith("/api/manual-test/")).toBe(true);
      expect(options.credentials).toBe("same-origin");
      expect(options.cache).toBe("no-store");
      const headers = new Headers(options.headers);
      // Browser-generated headers: GET has no Origin, POST supplies exact Origin.
      expect(headers.has("origin")).toBe(false);
      if (options.method === "POST") headers.set("origin", ORIGIN);
      headers.set("sec-fetch-site", "same-origin");
      headers.set("cookie", [...cookies].map(([key, value]) => `${key}=${value}`).join("; "));
      calls.push({ path: url.pathname, method: String(options.method), headers });
      const operation = url.pathname.split("/").at(-1)!;
      const response = await routes[operation](new Request(url, { ...options, headers }));
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0]; const index = pair.indexOf("=");
        const key = pair.slice(0, index); const value = pair.slice(index + 1);
        if (value) cookies.set(key, value); else cookies.delete(key);
      }
      if (loseResponse === operation) { loseResponse = null; throw new TypeError("Simulated connection loss after server commit"); }
      return response;
    }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function start() {
    const challenge = await manualRequest("csrf", csrfSchema);
    return manualRequest("bootstrap", bootstrapResult, { body: {}, csrf: challenge.csrf });
  }

  it("executes UI lifecycle with browser GET metadata, CSRF rotation, scoped results, safe retries, and cleanup", async () => {
    const created = await start();
    const runId = created.runId;
    let operator = await manualRequest("session", operatorSession, { query: { runId, scope: "OPERATOR" } });
    expect(operator.csrf).not.toBe(created.csrf);
    await expect(manualRequest("classes", z.object({ classId: uuid }), { csrf: created.csrf, body: { runId, teacherIds: ["teacher-1", "teacher-2"], quotedAmount: 100, startsAt: START + 3_600_000, endsAt: START + 7_200_000 } })).rejects.toMatchObject({ code: "CSRF_DENIED" });
    const classRow = await manualRequest("classes", z.object({ classId: uuid }), { csrf: operator.csrf, body: { runId, capacity: 8, teacherIds: ["teacher-1", "teacher-2"], quotedAmount: 100, startsAt: START + 3_600_000, endsAt: START + 7_200_000 } });
    const linked = await manualRequest("links", linkResult, { csrf: operator.csrf, body: { runId, classId: classRow.classId } });
    const url = reservationUrl(ORIGIN, runId, linked.grant);
    expect(new URL(url).searchParams.has("grant")).toBe(false);
    const location = readReservationLocation(url);
    const challenge = await manualRequest("csrf", csrfSchema);
    await manualRequest("exchange", csrfSchema, { csrf: challenge.csrf, body: location });
    let reservation = await manualRequest("session", reservationSession, { query: { runId, scope: "RESERVATION" } });
    expect(reservation.application).toBeNull();
    expect(reservation).not.toHaveProperty("data");
    await expect(manualRequest("submission", z.unknown(), { csrf: reservation.csrf, body: { runId, childId: "child-1", realName: "forbidden synthetic field" } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const submitted = await manualRequest("submission", z.object({ applicationId: uuid, applications: z.array(z.object({ id: uuid, childId: z.string() })) }), { csrf: reservation.csrf, body: { runId, childIds: ["child-1", "child-2"] } });
    expect(submitted.applications.map((row) => row.childId)).toEqual(["child-1", "child-2"]);
    reservation = await manualRequest("session", reservationSession, { query: { runId, scope: "RESERVATION" } });
    expect(reservation.applications).toHaveLength(2);
    await expect(manualRequest("submission", z.unknown(), { csrf: reservation.csrf, body: { runId, childIds: ["child-3", "child-4"] } })).rejects.toMatchObject({ code: "ALREADY_SUBMITTED" });
    const keys = new RetryKeys();
    const deposit = { runId, applicationId: submitted.applicationId, amount: 100 };
    const depositKey = keys.key("deposit", deposit);
    loseResponse = "deposit";
    await expect(manualRequest("deposit", z.object({ depositId: uuid }), { csrf: operator.csrf, body: { ...deposit, requestKey: depositKey } })).rejects.toThrow("Simulated connection loss");
    expect(keys.key("deposit", deposit)).toBe(depositKey);
    await manualRequest("deposit", z.object({ depositId: uuid }), { csrf: operator.csrf, body: { ...deposit, requestKey: depositKey } });
    keys.done("deposit", deposit);
    operator = await manualRequest("session", operatorSession, { query: { runId, scope: "OPERATOR" } });
    expect(operator.data.deposits).toHaveLength(1);
    const confirmed = await manualRequest("confirm", z.object({ reservationId: uuid }), { csrf: operator.csrf, body: { runId, applicationId: submitted.applicationId, confirmOverbooking: false } });
    reservation = await manualRequest("session", reservationSession, { query: { runId, scope: "RESERVATION" } });
    expect(reservation.application).toEqual({ id: submitted.applicationId, status: "CONFIRMED" });
    const payment = await manualRequest("payment", z.object({ paymentId: uuid }), { csrf: operator.csrf, body: { runId, reservationId: confirmed.reservationId, amount: operator.data.applications[submitted.applicationId].quotedAmount, requestKey: randomUUID() } });
    await manualRequest("refunds", z.object({ refundId: uuid }), { csrf: operator.csrf, body: { runId, paymentId: payment.paymentId, amount: 30, reason: "OTHER", detail: "SYNTHETIC_OTHER_APPROVAL", requestKey: randomUUID() } });
    expect(await manualRequest("revenue", revenueSchema, { query: { runId } })).toEqual({ gross: 100, refunds: 30, net: 70 });
    await manualRequest("cancel", z.object({ status: z.literal("CANCELLED") }), { csrf: operator.csrf, body: { runId, kind: "RESERVATION", targetId: confirmed.reservationId, reason: "SYNTHETIC_OPERATOR_CANCELLATION" } });
    await manualRequest("cancel", z.object({ status: z.literal("CANCELLED") }), { csrf: operator.csrf, body: { runId, kind: "CLASS", targetId: classRow.classId, reason: "SYNTHETIC_OPERATOR_CANCELLATION" } });
    reservation = await manualRequest("session", reservationSession, { query: { runId, scope: "RESERVATION" } });
    expect(reservation.classStatus).toBe("CANCELLED");
    expect(reservation.applications.map((row) => row.status)).toEqual(["CANCELLED", "PENDING"]);
    expect(await manualRequest("revenue", revenueSchema, { query: { runId } })).toEqual({ gross: 100, refunds: 30, net: 70 });
    const closed = await manualRequest("close", closedResult, { csrf: operator.csrf, body: { runId } });
    // Close refreshes the operator cookie so it survives for cleanup; only
    // the reservation cookie is cleared.
    expect(cookies.has("__Host-yaho-manual-test-operator")).toBe(true);
    expect(cookies.has("__Host-yaho-manual-test-reservation")).toBe(false);
    loseResponse = "cleanup";
    await expect(manualRequest("cleanup", cleanedResult, { csrf: closed.csrf, body: { runId } })).rejects.toThrow("Simulated connection loss");
    expect(await manualRequest("cleanup", cleanedResult, { csrf: closed.csrf, body: { runId } })).toEqual({ runId, status: "CLEANED" });
    await expect(manualRequest("session", reservationSession, { query: { runId, scope: "RESERVATION" } })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(calls.filter((call) => call.method === "GET").every((call) => !call.headers.has("origin"))).toBe(true);
  });

  it("rejects consumed grants, run substitution, and disabled runtime through client error handling", async () => {
    const operator = await start();
    const classRow = await manualRequest("classes", z.object({ classId: uuid }), { csrf: operator.csrf, body: { runId: operator.runId, teacherIds: ["teacher-1"], quotedAmount: 0, startsAt: START + 3_600_000, endsAt: START + 7_200_000 } });
    const link = await manualRequest("links", linkResult, { csrf: operator.csrf, body: { runId: operator.runId, classId: classRow.classId } });
    let challenge = await manualRequest("csrf", csrfSchema);
    await manualRequest("exchange", csrfSchema, { csrf: challenge.csrf, body: { runId: operator.runId, grant: link.grant } });
    challenge = await manualRequest("csrf", csrfSchema);
    await expect(manualRequest("exchange", csrfSchema, { csrf: challenge.csrf, body: { runId: operator.runId, grant: link.grant } })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(manualRequest("session", reservationSession, { query: { runId: randomUUID(), scope: "RESERVATION" } })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    vi.mocked(runtimeModule.getManualTestRuntime).mockReturnValue(setup({ enabled: false }));
    await expect(manualRequest("csrf", csrfSchema)).rejects.toMatchObject({ code: "MOCK_RUNTIME_DISABLED", status: 503 });
    expect(errorMessage(new ManualClientError("MOCK_RUNTIME_DISABLED", 503))).toContain("disabled");
  });

  it("validates grants and run IDs without query token leakage, and retains retry keys only until success", () => {
    const runId = randomUUID(); const grant = "a".repeat(43);
    expect(readReservationLocation(`${ORIGIN}/manual-test/reserve?runId=${runId}`)).toEqual({ runId, grant: null });
    for (const path of ["/manual-test/reserve", "/manual-test/reserve?runId=wrong", `/manual-test/reserve?runId=${runId}&grant=${grant}`, `/manual-test/reserve?runId=${runId}&runId=${runId}`, `/manual-test/reserve?runId=${runId}#short`]) expect(() => readReservationLocation(`${ORIGIN}${path}`)).toThrow();
    const keys = new RetryKeys(); const body = { amount: 3 };
    const key = keys.key("refunds", body);
    expect(keys.key("refunds", body)).toBe(key);
    expect(keys.key("deposit", body)).not.toBe(key);
    expect(keys.key("refunds", { amount: 4 })).not.toBe(key);
    keys.done("refunds", body);
    expect(keys.key("refunds", body)).not.toBe(key);
  });
});
