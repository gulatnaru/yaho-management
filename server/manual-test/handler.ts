import "server-only";
import { z, ZodError } from "zod";
import { MANUAL_COOKIES, manualCookie } from "./auth";
import { runIdSchema } from "./contracts";
import { ManualTestError, requireManual } from "./errors";
import { getManualTestRuntime } from "./runtime";

const responseHeaders = {
  "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff",
};
type PostOperation = "bootstrap" | "exchange" | "classes" | "links" | "submission" | "deposit" | "confirm" | "cancel" | "payment" | "refunds" | "close" | "cleanup";
type CookieResult = { cookie?: string };
async function guarded(operation: () => Promise<unknown>, closing = false) {
  try {
    const result = await operation();
    const { cookie, ...body } = result as CookieResult & Record<string, unknown>;
    const response = Response.json(body, { headers: responseHeaders });
    if (cookie) response.headers.append("Set-Cookie", cookie);
    // Close clears only the reservation cookie; the operator cookie is
    // refreshed by close() itself and must survive to authorize cleanup.
    if (closing) response.headers.append("Set-Cookie", manualCookie(MANUAL_COOKIES.reservation, "", 0));
    return response;
  } catch (error) {
    const status = error instanceof ManualTestError ? error.status : error instanceof ZodError ? 400 : 500;
    const code = error instanceof ManualTestError ? error.code : status === 400 ? "INVALID_INPUT" : "MOCK_REQUEST_FAILED";
    return Response.json({ error: code }, { status, headers: responseHeaders });
  }
}

export function createManualTestPostRoute(operation: PostOperation) {
  return (request: Request) => guarded(async () => {
    const runtime = getManualTestRuntime();
    runtime.auth.assertOrigin(request);
    requireManual(request.method === "POST", "METHOD_DENIED", 405);
    requireManual(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json", "JSON_REQUIRED", 415);
    const text = await request.text();
    requireManual(text.length <= 16_384, "BODY_TOO_LARGE", 413);
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw new ManualTestError("INVALID_JSON"); }
    switch (operation) {
      case "bootstrap": return runtime.auth.bootstrap(request, input);
      case "exchange": return runtime.auth.exchange(request, input);
      case "classes": return runtime.flow.createClass(request, input);
      case "links": return runtime.flow.createGrant(request, input);
      case "submission": return runtime.flow.submit(request, input);
      case "deposit": return runtime.flow.deposit(request, input);
      case "confirm": return runtime.flow.confirm(request, input);
      case "cancel": return runtime.flow.cancel(request, input);
      case "payment": return runtime.flow.payment(request, input);
      case "refunds": return runtime.flow.refund(request, input);
      case "close": return runtime.cleanup.close(request, input);
      case "cleanup": return runtime.cleanup.cleanup(request, input);
    }
  }, operation === "close");
}

const querySchema = z.object({ runId: runIdSchema }).strict();
const sessionQuerySchema = querySchema.extend({ scope: z.enum(["OPERATOR", "RESERVATION"]).default("OPERATOR") }).strict();
export function createManualTestGetRoute(operation: "csrf" | "session" | "revenue") {
  return (request: Request) => guarded(async () => {
    const runtime = getManualTestRuntime();
    runtime.auth.assertOrigin(request);
    requireManual(request.method === "GET", "METHOD_DENIED", 405);
    const search = new URL(request.url).searchParams;
    const keys = [...search.keys()];
    requireManual(new Set(keys).size === keys.length, "INVALID_INPUT");
    if (operation === "csrf") {
      z.object({}).strict().parse(Object.fromEntries(search));
      return runtime.auth.issueChallenge(request);
    }
    if (operation === "session") {
      const query = sessionQuerySchema.parse(Object.fromEntries(search));
      return runtime.flow.session(request, query.runId, query.scope);
    }
    const query = querySchema.parse(Object.fromEntries(search));
    return runtime.flow.revenue(request, query.runId);
  });
}
