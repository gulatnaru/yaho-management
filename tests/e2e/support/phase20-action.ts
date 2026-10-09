import { test, type Locator, type Page, type Request } from "@playwright/test";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { PHASE20_PREVIEW_RUN_ID_PATTERN } from "@/lib/e2e/phase20-lease";
import { PREVIEW_E2E_TEST_FILES } from "@/lib/e2e/preview-runner";
import type { PrismaClient } from "@prisma/client";
import { assertPreviewE2eRunnerProof } from "@/lib/e2e/preview-runner";
import { hasActivePhase20PreviewLease, parseAndVerifySignedPreviewRun } from "@/lib/e2e/phase20-lease";
type FixedActionSignals = { nonceMatched: boolean; headers2xx: boolean; resultMatched: boolean; streamFinished: boolean; streamFailed: boolean; pendingSeen: boolean; settled: boolean };

export const PHASE20_ACTION_TIMEOUT_MS = 30_000;
export type ActionObservation = { started: boolean; finished: boolean; failed: boolean; httpError: boolean; failureCategory?: "ABORTED" | "OTHER"; nonceMatched?: boolean };
export function classifyRequestFailure(value: string | null | undefined): "ABORTED" | "OTHER" { return value === "net::ERR_ABORTED" ? "ABORTED" : "OTHER"; }
export function multipartNonceMatches(body: string | null, nonce: string): boolean { return Boolean(body?.split(/\r?\n--/).some((part) => /name="(?:[^"\r\n]*_)?idempotencyKey"/.test(part.split(/\r?\n\r?\n/)[0] ?? "") && part.split(/\r?\n\r?\n/)[1]?.split(/\r?\n/)[0] === nonce)); }
export function initialDepositProven(input: { initialBalanceAbsent: boolean; beforeCount: number; afterCount: number; nonceMatched: boolean; pendingSeen: boolean; settled: boolean; fieldsMatch: boolean }): boolean { return input.initialBalanceAbsent && input.beforeCount === 0 && input.afterCount === 1 && input.nonceMatched && input.pendingSeen && input.settled && input.fieldsMatch; }
export function replayDepositProven(input: { initialBalanceAbsent: boolean; freshResult: boolean; beforeCount: number; afterCount: number; nonceMatched: boolean; pendingSeen: boolean; settled: boolean; originalRowUnchanged: boolean; noError: boolean }): boolean { return input.initialBalanceAbsent && input.freshResult && input.beforeCount === 1 && input.afterCount === 1 && input.nonceMatched && input.pendingSeen && input.settled && input.originalRowUnchanged && input.noError; }
type ActionStep = "CONFIRM" | "DEPOSIT" | "DEPOSIT_INITIAL" | "DEPOSIT_REPLAY" | "INVITE_ISSUE" | "INVITE_REVOKE" | "OTHER";
export type Phase20Stage = "INITIAL_COMPLETION" | "FRIEND_COMPLETION" | "INVITE_BOUNDARIES" | "REVOKED_DEVICE_COMPLETION" | "INITIAL_CONFIRMATION" | "REPEAT_COMPLETION" | "REPEAT_CONFIRMATION" | "PURGE_VALIDATION" | "INITIAL_DEPOSIT" | "DEPOSIT_REPLAY" | "REJECTION" | "PARTIAL_RETURNS" | "FINAL_ASSERTIONS";
function recordSafeAction(value: { category: "ACTION_FINAL" | "ORIGINAL_15S_MISSED" | "OWNED_CONFIRM_COUNTS" | "STAGE" | "INITIAL_DEPOSIT_PROOF" | "REPLAY_DEPOSIT_PROOF"; step: ActionStep; startedMs?: number | null; headersMs?: number | null; finishedMs?: number | null; resultMs?: number | null; state?: ActionObservation; reservations?: number; mappings?: number; stage?: Phase20Stage; elapsedMs?: number; replay?: FixedActionSignals; depositCount?: number; beforeCount?: number; amountMatches?: boolean }) {
  if (process.env.PLAYWRIGHT_PREVIEW_E2E !== "1") return;
  const runId = process.env.YAHO_E2E_RUN_ID ?? "";
  const source = PREVIEW_E2E_TEST_FILES.find((file) => path.resolve(file) === path.resolve(test.info().file));
  if (!PHASE20_PREVIEW_RUN_ID_PATTERN.test(runId) || !source) throw new Error("P20_ACTION_DIAGNOSTIC_GUARD_DENIED");
  const number = (input: number | null | undefined, limit: number) => input !== undefined && input !== null && Number.isSafeInteger(input) && input >= 0 && input <= limit ? input : null;
  const safe = {
    source, category: value.category, step: value.step,
    startedMs: number(value.startedMs, 300_000), headersMs: number(value.headersMs, 300_000), finishedMs: number(value.finishedMs, 300_000), resultMs: number(value.resultMs, 300_000),
    started: value.state?.started === true, finished: value.state?.finished === true, failed: value.state?.failed === true, httpError: value.state?.httpError === true,
    failureCategory: value.state?.failed ? value.state.failureCategory === "ABORTED" ? "ABORTED" : "OTHER" : "NONE",
    reservations: number(value.reservations, 8), mappings: number(value.mappings, 8),
    stage: value.stage ?? "NONE", elapsedMs: number(value.elapsedMs, 420_000),
    nonceMatched: value.replay?.nonceMatched === true || value.state?.nonceMatched === true, headers2xx: value.replay?.headers2xx === true, resultMatched: value.replay?.resultMatched === true, streamFinished: value.replay?.streamFinished === true, streamFailed: value.replay?.streamFailed === true, pendingSeen: value.replay?.pendingSeen === true, settled: value.replay?.settled === true, depositCount: number(value.depositCount, 8), beforeCount: number(value.beforeCount, 8), amountMatches: value.amountMatches === true,
  };
  appendFileSync(path.resolve("test-results", `preview-e2e-${runId}.safe-actions.jsonl`), JSON.stringify(safe) + "\n", { encoding: "utf8", mode: 0o600 });
}
export function recordPhase20Stage(stage: Phase20Stage, startedAt: number): void { recordSafeAction({ category: "STAGE", step: "OTHER", stage, elapsedMs: Date.now() - startedAt }); }
export function recordInitialDepositProof(input: { beforeCount: number; afterCount: number; nonceMatched: boolean; pendingSeen: boolean; settled: boolean; fieldsMatch: boolean }): void { recordSafeAction({ category: "INITIAL_DEPOSIT_PROOF", step: "DEPOSIT_INITIAL", beforeCount: input.beforeCount, depositCount: input.afterCount, amountMatches: input.fieldsMatch, replay: { nonceMatched: input.nonceMatched, headers2xx: false, resultMatched: false, streamFinished: false, streamFailed: false, pendingSeen: input.pendingSeen, settled: input.settled } }); }
export function recordReplayDepositProof(input: Parameters<typeof replayDepositProven>[0]): void { recordSafeAction({ category: "REPLAY_DEPOSIT_PROOF", step: "DEPOSIT_REPLAY", beforeCount: input.beforeCount, depositCount: input.afterCount, amountMatches: input.originalRowUnchanged, replay: { nonceMatched: input.nonceMatched, headers2xx: false, resultMatched: input.initialBalanceAbsent && input.freshResult && input.noError, streamFinished: false, streamFailed: false, pendingSeen: input.pendingSeen, settled: input.settled } }); }

export function classifyPhase20ActionFailure(state: ActionObservation): string {
  if (state.httpError) return "P20_ACTION_HTTP_ERROR";
  if (state.failed) return "P20_ACTION_REQUEST_FAILED";
  if (!state.started) return "P20_ACTION_REQUEST_NOT_STARTED";
  if (!state.finished) return "P20_ACTION_REQUEST_UNFINISHED";
  return "P20_ACTION_RESULT_UNREACHED";
}

/** Match only this page's Server Action; retain no URL, body, or error text. */
export async function clickAndExpectPhase20Action(page: Page, button: Locator, result: Locator, now: () => number = Date.now, step: ActionStep = "OTHER", confirmedPostconditions?: (state: ActionObservation) => Promise<boolean>, expectedNonce?: string): Promise<void> {
  const state: ActionObservation = { started: false, finished: false, failed: false, httpError: false };
  const times = { startedMs: null as number | null, headersMs: null as number | null, finishedMs: null as number | null, resultMs: null as number | null };
  const startedAt = now();
  let matched: Request | undefined;
  let finish: (() => void) | undefined;
  const ended = new Promise<void>((resolve) => { finish = resolve; });
  const request = (value: Request) => {
    const path = new URL(value.url()).pathname;
    if (!matched && value.method() === "POST" && value.headers()["next-action"] && (path === "/apply/complete" || path.startsWith("/reservation-applications/"))) { matched = value; state.started = true; times.startedMs = now() - startedAt; if (expectedNonce) state.nonceMatched = multipartNonceMatches(value.postData(), expectedNonce); }
  };
  const finished = (value: Request) => { if (value === matched) { state.finished = true; times.finishedMs = now() - startedAt; finish?.(); } };
  const failed = (value: Request) => { if (value === matched) { state.failed = true; state.failureCategory = classifyRequestFailure(value.failure()?.errorText); finish?.(); } };
  const response = (value: import("@playwright/test").Response) => { if (value.request() === matched) { times.headersMs = now() - startedAt; if (value.status() >= 400) state.httpError = true; } };
  page.on("request", request); page.on("requestfinished", finished); page.on("requestfailed", failed); page.on("response", response);
  const originalDeadline = setTimeout(() => { if (times.resultMs === null) recordSafeAction({ category: "ORIGINAL_15S_MISSED", step, ...times, state: { ...state } }); }, 15_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await button.click({ timeout: PHASE20_ACTION_TIMEOUT_MS });
    const remaining = PHASE20_ACTION_TIMEOUT_MS - (now() - startedAt);
    if (remaining <= 0) throw new Error("P20_ACTION_DEADLINE");
    await Promise.race([ended, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("P20_ACTION_DEADLINE")), remaining); })]);
    if (state.httpError || state.failed && !((step === "CONFIRM" || step === "DEPOSIT_INITIAL" || step === "DEPOSIT_REPLAY") && state.failureCategory === "ABORTED" && confirmedPostconditions)) throw new Error("P20_ACTION_NETWORK");
    const resultRemaining = PHASE20_ACTION_TIMEOUT_MS - (now() - startedAt);
    if (resultRemaining <= 0) throw new Error("P20_ACTION_DEADLINE");
    await result.waitFor({ state: "visible", timeout: resultRemaining });
    if (await result.count() !== 1) throw new Error("P20_ACTION_RESULT_UNREACHED");
    if (confirmedPostconditions) {
      const verificationRemaining = PHASE20_ACTION_TIMEOUT_MS - (now() - startedAt);
      if (verificationRemaining <= 0) throw new Error("P20_ACTION_DEADLINE");
      if (timer) clearTimeout(timer);
      const verified = await Promise.race([confirmedPostconditions(state), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("P20_ACTION_DEADLINE")), verificationRemaining); })]);
      if (!verified) throw new Error("P20_ACTION_RESULT_UNREACHED");
    }
    times.resultMs = now() - startedAt;
  } catch {
    throw new Error(classifyPhase20ActionFailure(state));
  } finally {
    if (timer) clearTimeout(timer);
    clearTimeout(originalDeadline);
    page.off("request", request); page.off("requestfinished", finished); page.off("requestfailed", failed); page.off("response", response);
    recordSafeAction({ category: "ACTION_FINAL", step, ...times, state });
  }
}

export async function confirmSelectedApplications(page: Page, input: { prisma: PrismaClient; submissionId: string; applicationIds: string[]; childNames: string[]; ownedCounts?: () => Promise<{ reservations: number; mappings: number }> }): Promise<void> {
  const childPattern = new RegExp(input.childNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
  const rows = page.getByRole("heading", { name: "아이별 신청", exact: true }).locator("..").locator(":scope > div").filter({ hasText: childPattern }).filter({ hasText: /\bCONFIRMED\b/ });
  try {
    await clickAndExpectPhase20Action(page, page.getByRole("button", { name: "선택한 아이 일괄 확정", exact: true }), rows.first(), Date.now, "CONFIRM", async () => {
      assertPreviewE2eRunnerProof({ proofPath: process.env.PREVIEW_E2E_RUNNER_PROOF_PATH, proof: process.env.PREVIEW_E2E_RUNNER_PROOF });
      const environment = { ...process.env, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: process.env.PREVIEW_E2E_DEPLOYMENT_SHA };
      const runId = process.env.YAHO_E2E_RUN_ID ?? "";
      const signed = parseAndVerifySignedPreviewRun(process.env.PREVIEW_E2E_PHASE20_SIGNED_RUN ?? null, environment);
      if (!await hasActivePhase20PreviewLease(input.prisma, { signed, syntheticRunId: runId, now: new Date(), environment })) return false;
      const confirmed = await input.prisma.reservationApplication.findMany({ where: { id: { in: input.applicationIds }, submissionId: input.submissionId, submission: { group: { syntheticRunId: runId } } }, select: { status: true, reservationId: true, quotedAmount: true, paymentMapping: { select: { paymentItem: { select: { amount: true, reservationId: true } } } } } });
      return confirmed.length === input.applicationIds.length && await rows.count() === input.childNames.length && await page.getByRole("button", { name: "선택한 아이 일괄 확정", exact: true }).count() === 0 && confirmed.every((application) => application.status === "CONFIRMED" && application.reservationId !== null && application.paymentMapping?.paymentItem.reservationId === application.reservationId && application.paymentMapping.paymentItem.amount === application.quotedAmount);
    });
  } catch (error) {
    if (input.ownedCounts) recordSafeAction({ category: "OWNED_CONFIRM_COUNTS", step: "CONFIRM", ...await input.ownedCounts() });
    throw error;
  }
}
