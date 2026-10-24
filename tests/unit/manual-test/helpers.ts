import { randomUUID } from "node:crypto";
import { MockManualTestPrisma } from "@/lib/db/manual-test-prisma";
import { ManualTestAuth, verifyPayload, type ManualMockConfig } from "@/server/manual-test/auth";
import { createManualTestRuntime } from "@/server/manual-test/runtime";

export const ORIGIN = "https://manual.test";
export const SYNTHETIC_SECRET = "synthetic-test-bootstrap-secret-0000000000";
export const START = Date.UTC(2026, 9, 18, 10);
export function request(method = "POST", cookie = "", csrf = "", path = "/api/manual-test/mock", headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, { method, headers: { origin: ORIGIN, cookie, "x-manual-test-csrf": csrf, ...headers } });
}
export function cookiePair(cookie: string) { return cookie.split(";")[0]; }
export function signedCookiePayload(cookie: string, purpose: "challenge" | "session:OPERATOR" | "session:RESERVATION", now = START, secret = SYNTHETIC_SECRET) {
  return verifyPayload(cookiePair(cookie).split("=")[1], secret, purpose, now);
}
export function setup(overrides: Partial<ManualMockConfig> = {}, verifyAdminSession?: () => Promise<boolean>) {
  const db = new MockManualTestPrisma();
  const clock = { now: START };
  const auth = new ManualTestAuth(db, { enabled: true, nodeEnv: "test", origin: ORIGIN, syntheticBootstrapSecret: SYNTHETIC_SECRET, ...overrides }, () => clock.now, verifyAdminSession);
  const runtime = createManualTestRuntime(auth);
  return { ...runtime, db, clock };
}
export async function bootstrap(context: ReturnType<typeof setup>) {
  const challenge = await context.auth.issueChallenge(request("GET"));
  const result = await context.auth.bootstrap(request("POST", cookiePair(challenge.cookie), challenge.csrf, undefined, { "x-manual-test-bootstrap-secret": SYNTHETIC_SECRET }), {});
  const cookie = cookiePair(result.cookie);
  const sessionHash = signedCookiePayload(cookie, "session:OPERATOR", context.clock.now).h;
  return { ...result, cookie, sessionHash, post: () => request("POST", cookie, result.csrf), get: () => request("GET", cookie) };
}
/** Close a run and return the refreshed operator cookie + csrf for cleanup. */
export async function close(context: ReturnType<typeof setup>, operator: Awaited<ReturnType<typeof bootstrap>>) {
  const result = await context.cleanup.close(operator.post(), { runId: operator.runId });
  const cookie = cookiePair(result.cookie);
  return { ...result, cookie, post: () => request("POST", cookie, result.csrf) };
}
export async function fixtureClass(context: ReturnType<typeof setup>, operator: Awaited<ReturnType<typeof bootstrap>>, overrides = {}) {
  return context.flow.createClass(operator.post(), { runId: operator.runId, teacherIds: ["teacher-1", "teacher-2"], quotedAmount: 100, startsAt: START + 3_600_000, endsAt: START + 7_200_000, ...overrides });
}
export async function reservationSession(context: ReturnType<typeof setup>, operator: Awaited<ReturnType<typeof bootstrap>>, classId: string) {  const link = await context.flow.createGrant(operator.post(), { runId: operator.runId, classId });
  const challenge = await context.auth.issueChallenge(request("GET"));
  const issued = await context.auth.exchange(request("POST", cookiePair(challenge.cookie), challenge.csrf), { runId: operator.runId, grant: link.grant });
  const cookie = cookiePair(issued.cookie);
  return { ...issued, cookie, post: () => request("POST", cookie, issued.csrf), get: () => request("GET", cookie) };
}
export async function application(context: ReturnType<typeof setup>, operator: Awaited<ReturnType<typeof bootstrap>>, classId: string, childId = "child-1", amount = 100) {
  const reservation = await reservationSession(context, operator, classId);
  const submitted = await context.flow.submit(reservation.post(), { runId: operator.runId, childId });
  if (amount > 0) await context.flow.deposit(operator.post(), { runId: operator.runId, applicationId: submitted.applicationId, amount, requestKey: randomUUID() });
  return { ...submitted, reservation };
}
export async function paidFixture(context: ReturnType<typeof setup>) {
  const operator = await bootstrap(context);
  const { classId } = await fixtureClass(context, operator);
  const submitted = await application(context, operator, classId);
  const confirmed = await context.flow.confirm(operator.post(), { runId: operator.runId, applicationId: submitted.applicationId });
  const paid = await context.flow.payment(operator.post(), { runId: operator.runId, reservationId: confirmed.reservationId, amount: 100, requestKey: randomUUID() });
  return { operator, classId, ...submitted, ...confirmed, ...paid };
}
