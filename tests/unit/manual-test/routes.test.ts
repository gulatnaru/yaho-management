import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GET as csrfGET } from "@/app/api/manual-test/csrf/route";
import { POST as bootstrapPOST } from "@/app/api/manual-test/bootstrap/route";
import { POST as classesPOST } from "@/app/api/manual-test/classes/route";
import { POST as linksPOST } from "@/app/api/manual-test/links/route";
import { POST as exchangePOST } from "@/app/api/manual-test/exchange/route";
import { POST as submissionPOST } from "@/app/api/manual-test/submission/route";
import { POST as depositPOST } from "@/app/api/manual-test/deposit/route";
import { POST as confirmPOST } from "@/app/api/manual-test/confirm/route";
import { POST as paymentPOST } from "@/app/api/manual-test/payment/route";
import { POST as refundsPOST } from "@/app/api/manual-test/refunds/route";
import { POST as cancelPOST } from "@/app/api/manual-test/cancel/route";
import { POST as closePOST } from "@/app/api/manual-test/close/route";
import { POST as cleanupPOST } from "@/app/api/manual-test/cleanup/route";
import { GET as revenueGET } from "@/app/api/manual-test/revenue/route";
import { GET as sessionGET } from "@/app/api/manual-test/session/route";
import * as runtimeModule from "@/server/manual-test/runtime";
import { ORIGIN, START, SYNTHETIC_SECRET, cookiePair, setup } from "./helpers";

type Actor = { cookie: string; csrf: string };
type Route = (request: Request) => Promise<Response>;
let context: ReturnType<typeof setup>;
function call(route: Route, path: string, input?: unknown, actor?: Actor, headers = {}) {
  return route(new Request(`${ORIGIN}/api/manual-test/${path}`, {
    method: input === undefined ? "GET" : "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", cookie: actor?.cookie ?? "", "x-manual-test-csrf": actor?.csrf ?? "", ...headers },
    body: input === undefined ? undefined : JSON.stringify(input),
  }));
}
async function challenge() {
  const response = await call(csrfGET, "csrf");
  const data = await response.json();
  return { cookie: cookiePair(response.headers.get("set-cookie")!), csrf: data.csrf as string };
}
async function start() {
  const response = await call(bootstrapPOST, "bootstrap", {}, await challenge(), { "x-manual-test-bootstrap-secret": SYNTHETIC_SECRET });
  expect(response.status).toBe(200);
  const body = await response.json();
  return { runId: body.runId as string, cookie: cookiePair(response.headers.get("set-cookie")!), csrf: body.csrf as string };
}

describe("actual manual-test Route Handlers (DB-free)", () => {
  beforeEach(() => {
    context = setup();
    vi.spyOn(runtimeModule, "getManualTestRuntime").mockReturnValue(context);
  });
  afterEach(() => vi.restoreAllMocks());

  it("executes all routes: synthetic bootstrap, reservation, deposit, confirm, payment, refund, revenue, close, cleanup", async () => {
    const operator = await start();
    const runId = operator.runId;
    const created = await call(classesPOST, "classes", { runId, teacherIds: ["teacher-1", "teacher-2"], quotedAmount: 100, startsAt: START + 3_600_000, endsAt: START + 7_200_000 }, operator);
    expect(created.status).toBe(200);
    const { classId } = await created.json();
    const linked = await call(linksPOST, "links", { runId, classId }, operator);
    expect(linked.status).toBe(200);
    const { grant } = await linked.json();
    const exchanged = await call(exchangePOST, "exchange", { runId, grant }, await challenge());
    expect(exchanged.status).toBe(200);
    const exchangedBody = await exchanged.json();
    const reservation = { cookie: cookiePair(exchanged.headers.get("set-cookie")!), csrf: exchangedBody.csrf as string };
    const submitted = await call(submissionPOST, "submission", { runId, childId: "child-1" }, reservation);
    expect(submitted.status).toBe(200);
    const { applicationId } = await submitted.json();
    const deposited = await call(depositPOST, "deposit", { runId, applicationId, amount: 150, requestKey: randomUUID() }, operator);
    expect(deposited.status).toBe(200);
    const confirmed = await call(confirmPOST, "confirm", { runId, applicationId }, operator);
    expect(confirmed.status).toBe(200);
    const { reservationId } = await confirmed.json();
    const paid = await call(paymentPOST, "payment", { runId, reservationId, amount: 100, requestKey: randomUUID() }, operator);
    expect(paid.status).toBe(200);
    const { paymentId } = await paid.json();
    const refunded = await call(refundsPOST, "refunds", { runId, paymentId, amount: 30, reason: "CUSTOMER_REQUEST", requestKey: randomUUID() }, operator);
    expect(refunded.status).toBe(200);
    const revenue = await call(revenueGET, `revenue?runId=${runId}`, undefined, operator);
    expect(await revenue.json()).toEqual({ gross: 100, refunds: 30, net: 70 });
    const session = await call(sessionGET, `session?runId=${runId}&scope=RESERVATION`, undefined, reservation);
    expect(await session.json()).toMatchObject({ runId, scope: "RESERVATION", application: { id: applicationId } });
    const closed = await call(closePOST, "close", { runId }, operator);
    expect(closed.status).toBe(200);
    const closedBody = await closed.json();
    const setCookies = closed.headers.getSetCookie();
    // Close refreshes the operator cookie (it survives for cleanup) and
    // clears only the reservation cookie.
    const operatorCookie = setCookies.find((value) => value.startsWith("__Host-yaho-manual-test-operator="))!;
    expect(operatorCookie).toContain("Path=/");
    expect(operatorCookie).not.toContain("Max-Age=0");
    expect(cookiePair(operatorCookie)).not.toBe(operator.cookie);
    const reservationCleared = setCookies.find((value) => value.startsWith("__Host-yaho-manual-test-reservation="))!;
    expect(reservationCleared).toContain("Max-Age=0");
    const cleanup = { cookie: cookiePair(operatorCookie), csrf: closedBody.csrf as string };
    const cleaned = await call(cleanupPOST, "cleanup", { runId }, cleanup);
    expect(cleaned.status).toBe(200);
    expect(await cleaned.json()).toEqual({ runId, status: "CLEANED" });
    expect((await call(revenueGET, `revenue?runId=${runId}`, undefined, operator)).status).toBe(401);
  });

  it("routes cancellation with operator scope, CSRF and run ownership", async () => {
    const op = await start(); const runId = op.runId;
    const created = await call(classesPOST, "classes", { runId, teacherIds: ["teacher-1", "teacher-2"], quotedAmount: 0, startsAt: START + 3_600_000, endsAt: START + 7_200_000 }, op);
    const { classId } = await created.json();
    const body = { runId, kind: "CLASS", targetId: classId, reason: "SYNTHETIC_OPERATOR_CANCELLATION" };
    expect((await call(cancelPOST, "cancel", body, { ...op, csrf: "" })).status).toBe(403);
    expect((await call(cancelPOST, "cancel", body, { cookie: "authjs.session-token=admin", csrf: "" })).status).toBe(401);
    const other = await start();
    expect((await call(cancelPOST, "cancel", { ...body, runId: other.runId }, other)).status).toBe(409);
    const cancelled = await call(cancelPOST, "cancel", body, op);
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual({ targetId: classId, status: "CANCELLED" });
    expect((await call(linksPOST, "links", { runId, classId }, op)).status).toBe(409);
    expect(await (await call(revenueGET, `revenue?runId=${runId}`, undefined, op)).json()).toEqual({ gross: 0, refunds: 0, net: 0 });
  });

  it("returns secure cookies, no-store headers and no cookie/token internals in JSON", async () => {
    const response = await call(csrfGET, "csrf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    const cookie = response.headers.get("set-cookie")!;
    for (const attribute of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]) expect(cookie).toContain(attribute);
    const body = await response.json();
    expect(body).not.toHaveProperty("cookie");
    expect(JSON.stringify(body)).not.toContain(SYNTHETIC_SECRET);
  });

  it.each(["https://evil.test", "https://manual.test.evil", "", "null"])("denies Origin %s on reads and writes", async (origin) => {
    const operator = await start();
    const read = await call(revenueGET, `revenue?runId=${operator.runId}`, undefined, operator, { origin });
    const write = await call(closePOST, "close", { runId: operator.runId }, operator, { origin });
    expect(read.status).toBe(403);
    expect(write.status).toBe(403);
    expect(read.headers.get("cache-control")).toBe("no-store");
  });

  it("denies ADMIN/E2E-only, CSRF omission and run substitution", async () => {
    const first = await start();
    const second = await start();
    expect((await call(revenueGET, `revenue?runId=${first.runId}`, undefined, { cookie: "authjs.session-token=admin; e2e=lease", csrf: "" })).status).toBe(401);
    expect((await call(closePOST, "close", { runId: first.runId }, { ...first, csrf: "" })).status).toBe(403);
    expect((await call(revenueGET, `revenue?runId=${second.runId}`, undefined, first)).status).toBe(401);
  });

  it("validates Zod fields, malformed JSON, repeated query keys, media type and size", async () => {
    const operator = await start();
    expect((await call(closePOST, "close", { runId: operator.runId, realName: "do not persist" }, operator)).status).toBe(400);
    expect((await call(revenueGET, `revenue?runId=${operator.runId}&runId=${operator.runId}`, undefined, operator)).status).toBe(400);
    expect((await call(revenueGET, "revenue?runId=public", undefined, operator)).status).toBe(400);
    expect((await call(closePOST, "close", { runId: operator.runId }, operator, { "content-type": "text/plain" })).status).toBe(415);
    const malformed = await closePOST(new Request(`${ORIGIN}/api/manual-test/close`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{" }));
    expect(await malformed.json()).toEqual({ error: "INVALID_JSON" });
    expect((await call(closePOST, "close", { runId: "x".repeat(20_000) }, operator)).status).toBe(413);
  });

  it("session endpoint gives operator synthetic fixtures and rotates hashed CSRF", async () => {
    const operator = await start();
    const response = await call(sessionGET, `session?runId=${operator.runId}`, undefined, operator);
    const session = await response.json();
    expect(session.fixtureTeacherIds).toEqual(["teacher-1", "teacher-2"]);
    expect(Object.keys(session.data.children)).toHaveLength(12);
    expect(session).not.toHaveProperty("sessions");
    const cookie = cookiePair(response.headers.get("set-cookie")!);
    expect((await call(closePOST, "close", { runId: operator.runId }, { ...operator, cookie })).status).toBe(403);
    expect((await call(closePOST, "close", { runId: operator.runId }, { ...operator, cookie, csrf: session.csrf as string })).status).toBe(200);
  });

  it("hides unexpected error details and fails closed when runtime is unavailable", async () => {
    vi.mocked(runtimeModule.getManualTestRuntime).mockImplementation(() => { throw new Error("must-never-appear-secret"); });
    const response = await call(csrfGET, "csrf");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "MOCK_REQUEST_FAILED" });
  });

  it("includes the DB stage in 500 responses when staged, omits invalid stages", async () => {
    const staged = new Error("must-never-appear-secret") as Error & { manualStage?: string };
    staged.manualStage = "tx_commit";
    vi.mocked(runtimeModule.getManualTestRuntime).mockImplementation(() => { throw staged; });
    const withStage = await call(csrfGET, "csrf");
    expect(withStage.status).toBe(500);
    const withStageBody = await withStage.json();
    expect(withStageBody).toEqual({ error: "MOCK_REQUEST_FAILED", stage: "tx_commit" });
    expect(JSON.stringify(withStageBody)).not.toContain("must-never-appear-secret");

    const invalid = new Error("must-never-appear-secret") as Error & { manualStage?: string };
    invalid.manualStage = "TX_COMMIT; DROP TABLE";
    vi.mocked(runtimeModule.getManualTestRuntime).mockImplementation(() => { throw invalid; });
    const withoutStage = await call(csrfGET, "csrf");
    expect(withoutStage.status).toBe(500);
    expect(await withoutStage.json()).toEqual({ error: "MOCK_REQUEST_FAILED" });
  });

  it("includes the whitelisted table in 500 responses when staged, omits invalid tables", async () => {
    const staged = new Error("must-never-appear-secret") as Error & { manualStage?: string; manualTable?: string };
    staged.manualStage = "persist_run";
    staged.manualTable = "Payment";
    vi.mocked(runtimeModule.getManualTestRuntime).mockImplementation(() => { throw staged; });
    const withTable = await call(csrfGET, "csrf");
    expect(withTable.status).toBe(500);
    const withTableBody = await withTable.json();
    expect(withTableBody).toEqual({ error: "MOCK_REQUEST_FAILED", stage: "persist_run", table: "Payment" });
    expect(JSON.stringify(withTableBody)).not.toContain("must-never-appear-secret");

    const evil = new Error("must-never-appear-secret") as Error & { manualStage?: string; manualTable?: string };
    evil.manualStage = "persist_run";
    evil.manualTable = "Payment; DROP TABLE";
    vi.mocked(runtimeModule.getManualTestRuntime).mockImplementation(() => { throw evil; });
    const withoutTable = await call(csrfGET, "csrf");
    expect(withoutTable.status).toBe(500);
    expect(await withoutTable.json()).toEqual({ error: "MOCK_REQUEST_FAILED", stage: "persist_run" });

    const untyped = new Error("boom") as Error & { manualStage?: string; manualTable?: unknown };
    untyped.manualStage = "persist_run";
    untyped.manualTable = 42;
    vi.mocked(runtimeModule.getManualTestRuntime).mockImplementation(() => { throw untyped; });
    const untypedBody = await call(csrfGET, "csrf");
    expect(await untypedBody.json()).toEqual({ error: "MOCK_REQUEST_FAILED", stage: "persist_run" });
  });
});
