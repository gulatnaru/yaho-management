import type { Page, Request, Response } from "@playwright/test";
import { PHASE20_PREVIEW_HEADER } from "@/lib/e2e/phase20-lease";

// Live guarded evidence: successful RSC response finished at 16.148s and
// the full-document heading rendered at 20.487s. Budget the complete flow.
export const PUBLIC_COMPLETION_TIMEOUT_MS = 30_000;
export type CompletionEvent = "SUBMIT_STARTED" | "SUBMIT_FINISHED" | "SUBMIT_FAILED" | "SUBMIT_2XX" | "SUBMIT_3XX" | "SUBMIT_4XX" | "SUBMIT_5XX" | "SUBMIT_HTTP_OTHER" | "COMPLETE_STARTED" | "COMPLETE_FINISHED" | "COMPLETE_FAILED" | "COMPLETE_2XX" | "COMPLETE_3XX" | "COMPLETE_4XX" | "COMPLETE_5XX" | "COMPLETE_HTTP_OTHER" | "COMPLETE_HEADER_PRESENT" | "COMPLETE_HEADER_ABSENT";
export type CompletionObservation = { events: CompletionEvent[] };

export function classifyPublicCompletionFailure(observation: CompletionObservation, input: { headingCount: number; formAlertCount: number; preview: boolean }): string {
  const has = (event: CompletionEvent) => observation.events.includes(event);
  if (has("SUBMIT_5XX") || has("COMPLETE_5XX")) return "P20_PUBLIC_COMPLETION_ROUTE_5XX";
  if (has("SUBMIT_4XX")) return "P20_PUBLIC_SUBMIT_HTTP_4XX";
  if (has("COMPLETE_4XX")) return "P20_PUBLIC_COMPLETION_HTTP_4XX";
  if (has("SUBMIT_FAILED")) return "P20_PUBLIC_SUBMIT_REQUEST_FAILED";
  if (has("COMPLETE_FAILED")) return "P20_PUBLIC_COMPLETION_REQUEST_FAILED";
  if (input.headingCount > 1) return "P20_PUBLIC_COMPLETION_STRICT_LOCATOR";
  if (input.formAlertCount > 0) return "P20_PUBLIC_COMPLETION_ACTION_ALERT";
  if (input.preview && has("COMPLETE_HEADER_ABSENT")) return "P20_PUBLIC_COMPLETION_PREVIEW_HEADER_MISSING";
  if (!has("SUBMIT_STARTED")) return "P20_PUBLIC_SUBMIT_REQUEST_NOT_STARTED";
  if (!has("SUBMIT_FINISHED")) return "P20_PUBLIC_SUBMIT_REQUEST_UNFINISHED";
  if (has("COMPLETE_STARTED") && !has("COMPLETE_FINISHED")) return "P20_PUBLIC_COMPLETION_REQUEST_UNFINISHED";
  return "P20_PUBLIC_COMPLETION_TIMEOUT";
}

/** Observe only matched public requests. Never capture bodies, URLs or errors. */
export async function submitAndExpectPublicCompletion(page: Page, now: () => number = Date.now): Promise<void> {
  const observation: CompletionObservation = { events: [] };
  const record = (event: CompletionEvent) => { if (observation.events.length < 40) observation.events.push(event); };
  const submissions = new Set<Request>(); const completions = new Set<Request>();
  const request = (value: Request) => {
    const pathname = new URL(value.url()).pathname;
    if (value.method() === "POST" && pathname.startsWith("/apply/") && value.headers()["next-action"]) { submissions.add(value); record("SUBMIT_STARTED"); }
    if (value.method() === "GET" && pathname === "/apply/complete" && value.isNavigationRequest()) {
      completions.add(value); record("COMPLETE_STARTED");
      record(value.headers()[PHASE20_PREVIEW_HEADER] ? "COMPLETE_HEADER_PRESENT" : "COMPLETE_HEADER_ABSENT");
    }
  };
  const response = (value: Response) => {
    const statusClass = Math.floor(value.status() / 100);
    if (submissions.has(value.request())) record(statusClass === 2 ? "SUBMIT_2XX" : statusClass === 3 ? "SUBMIT_3XX" : statusClass === 4 ? "SUBMIT_4XX" : statusClass === 5 ? "SUBMIT_5XX" : "SUBMIT_HTTP_OTHER");
    if (completions.has(value.request())) record(statusClass === 2 ? "COMPLETE_2XX" : statusClass === 3 ? "COMPLETE_3XX" : statusClass === 4 ? "COMPLETE_4XX" : statusClass === 5 ? "COMPLETE_5XX" : "COMPLETE_HTTP_OTHER");
  };
  const finished = (value: Request) => { if (submissions.has(value)) record("SUBMIT_FINISHED"); if (completions.has(value)) record("COMPLETE_FINISHED"); };
  const failed = (value: Request) => { if (submissions.has(value)) record("SUBMIT_FAILED"); if (completions.has(value)) record("COMPLETE_FAILED"); };
  page.on("request", request); page.on("response", response); page.on("requestfinished", finished); page.on("requestfailed", failed);
  const form = page.locator("form").filter({ has: page.locator('input[name="payload"]') });
  const heading = page.getByRole("heading", { name: "신청이 접수되었습니다", exact: true });
  const startedAt = now();
  try {
    try {
      await form.getByRole("button", { name: "신청하기", exact: true }).click({ timeout: PUBLIC_COMPLETION_TIMEOUT_MS });
      const remainingMs = PUBLIC_COMPLETION_TIMEOUT_MS - (now() - startedAt);
      if (remainingMs <= 0) throw new Error("P20_PUBLIC_COMPLETION_TIMEOUT");
      await heading.waitFor({ state: "visible", timeout: remainingMs });
    } catch {
      throw new Error(classifyPublicCompletionFailure(observation, { headingCount: await heading.count(), formAlertCount: await form.getByRole("alert").count(), preview: process.env.PLAYWRIGHT_PREVIEW_E2E === "1" }));
    }
    if (await heading.count() !== 1) throw new Error("P20_PUBLIC_COMPLETION_STRICT_LOCATOR");
    if (process.env.PLAYWRIGHT_PREVIEW_E2E === "1" && observation.events.includes("COMPLETE_HEADER_ABSENT")) throw new Error("P20_PUBLIC_COMPLETION_PREVIEW_HEADER_MISSING");
  } finally { page.off("request", request); page.off("response", response); page.off("requestfinished", finished); page.off("requestfailed", failed); }
}
