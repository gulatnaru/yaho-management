import "server-only";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { emptyMockData, type ManualTestDatabase, type MockRun, type MockSession } from "@/lib/db/manual-test-prisma";
import { bootstrapSchema, exchangeSchema, tokenSchema } from "./contracts";
import { ManualTestError, requireManual } from "./errors";

export const MANUAL_COOKIES = {
  operator: "__Host-yaho-manual-test-operator",
  reservation: "__Host-yaho-manual-test-reservation",
  challenge: "__Host-yaho-manual-test-challenge",
  cleanup: "__Host-yaho-manual-test-cleanup",
} as const;
export const MOCK_TTL = { run: 60 * 60_000, session: 15 * 60_000, grant: 5 * 60_000, challenge: 5 * 60_000 } as const;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const payloadSchema = z.object({ h: hashSchema, c: hashSchema, exp: z.number().int().positive().max(8.64e15) }).strict();
const signedTokenSchema = z.string().max(512).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
type SignedPayload = z.infer<typeof payloadSchema>;
type TokenPurpose = "challenge" | "session:OPERATOR" | "session:RESERVATION";

function payloadSignature(encoded: string, secret: string, purpose: TokenPurpose) {
  return createHmac("sha256", secret).update(`yaho-manual-test:${purpose}\0${encoded}`).digest();
}
export function signPayload(payload: SignedPayload, secret: string, purpose: TokenPurpose) {
  const encoded = Buffer.from(JSON.stringify(payloadSchema.parse(payload))).toString("base64url");
  return `${encoded}.${payloadSignature(encoded, secret, purpose).toString("base64url")}`;
}
export function verifyPayload(token: string, secret: string, purpose: TokenPurpose, now = Date.now()): SignedPayload {
  requireManual(signedTokenSchema.safeParse(token).success, "UNAUTHORIZED", 401);
  const [encoded, signature] = token.split(".");
  const supplied = Buffer.from(signature, "base64url");
  const expected = payloadSignature(encoded, secret, purpose);
  requireManual(supplied.length === expected.length && supplied.toString("base64url") === signature && timingSafeEqual(supplied, expected), "UNAUTHORIZED", 401);
  let value: unknown;
  try {
    const decoded = Buffer.from(encoded, "base64url");
    requireManual(decoded.toString("base64url") === encoded, "UNAUTHORIZED", 401);
    value = JSON.parse(decoded.toString("utf8"));
  } catch { throw new ManualTestError("UNAUTHORIZED", 401); }
  const parsed = payloadSchema.safeParse(value);
  requireManual(parsed.success && parsed.data.exp > now, "UNAUTHORIZED", 401);
  return parsed.data;
}

const configSchema = z.object({
  enabled: z.boolean(), nodeEnv: z.string(), deploymentEnv: z.string().optional(),
  origin: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  }),
  syntheticBootstrapSecret: z.string().min(32).max(256).optional(),
});
export type ManualMockConfig = z.input<typeof configSchema>;
/** Only bootstrap consults Auth.js; subsequent operations use isolated mock cookies. */
export async function verifyManualTestAdminSession(): Promise<boolean> {
  const [{ auth }, { resolveSessionPrincipal }] = await Promise.all([
    import("@/auth"), import("@/lib/auth/principal"),
  ]);
  const session = await auth();
  const principal = await resolveSessionPrincipal({ userId: session?.user?.id, authVersion: session?.user?.authVersion });
  return principal?.role === "ADMIN" && !principal.mustChangePassword;
}
export const opaqueToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (domain: string, token: string) => createHash("sha256").update(`${domain}\0${token}`).digest("hex");
function equalHash(left: string, right: string) {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
export function manualCookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}; Secure; HttpOnly; SameSite=Lax`;
}
export function readManualCookie(request: Request, name: string) {
  const values = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`)).map((part) => part.slice(name.length + 1));
  const schema = name === MANUAL_COOKIES.cleanup ? tokenSchema : signedTokenSchema;
  requireManual(values.length === 1 && schema.safeParse(values[0]).success, "UNAUTHORIZED", 401);
  return values[0];
}

export class ManualTestAuth {
  private readonly config: z.output<typeof configSchema>;
  constructor(readonly db: ManualTestDatabase, config: ManualMockConfig, readonly now = Date.now,
    private readonly verifyAdminSession: () => Promise<boolean> = verifyManualTestAdminSession) {
    const parsed = configSchema.safeParse(config);
    requireManual(parsed.success, "MOCK_RUNTIME_DISABLED", 503);
    this.config = parsed.data;
  }

  private signingSecret() {
    // Shared deployment credentials survive cold starts; never fall back to a process-local key.
    const secret = this.config.syntheticBootstrapSecret ?? process.env.AUTH_SECRET;
    requireManual(secret && secret.length >= 32, "MOCK_RUNTIME_DISABLED", 503);
    return secret;
  }

  assertRuntime() {
    requireManual(this.config.enabled && this.config.deploymentEnv !== "production" && (this.db.mode === "DATABASE" || this.config.nodeEnv === "test"), "MOCK_RUNTIME_DISABLED", 503);
  }

  assertOrigin(request: Request) {
    this.assertRuntime();
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    // Browsers omit Origin on same-origin GET. Fetch metadata must explicitly
    // establish same-origin in that case; writes still require exact Origin.
    const browserGet = request.method === "GET" && origin === null && site === "same-origin";
    requireManual((origin === this.config.origin || browserGet) && new URL(request.url).origin === this.config.origin, "ORIGIN_DENIED", 403);
    requireManual(!site || site === "same-origin", "ORIGIN_DENIED", 403);
  }

  async issueChallenge(request: Request) {
    this.assertOrigin(request);
    const csrf = opaqueToken();
    const token = signPayload({ h: tokenHash("challenge", opaqueToken()), c: tokenHash("csrf", csrf), exp: this.now() + MOCK_TTL.challenge }, this.signingSecret(), "challenge");
    return { csrf, cookie: manualCookie(MANUAL_COOKIES.challenge, token, MOCK_TTL.challenge) };
  }

  private async consumeChallenge(request: Request) {
    this.assertOrigin(request);
    // Stateless challenges remain valid until expiry; exchange grants retain one-use semantics.
    const challenge = verifyPayload(readManualCookie(request, MANUAL_COOKIES.challenge), this.signingSecret(), "challenge", this.now());
    this.verifyCsrf(request, challenge.c);
  }

  verifyCsrf(request: Request, hash: string) {
    const parsed = tokenSchema.safeParse(request.headers.get("x-manual-test-csrf"));
    requireManual(parsed.success && equalHash(tokenHash("csrf", parsed.data), hash), "CSRF_DENIED", 403);
  }

  issueSession(run: MockRun, scope: MockSession["scope"], classId?: string) {
    const hash = tokenHash("session", opaqueToken());
    const expiresAt = Math.min(run.expiresAt, this.now() + MOCK_TTL.session);
    const session = { hash, scope, runId: run.id, classId, expiresAt, revoked: false };
    const issued = this.refreshSession(session);
    run.sessions[hash] = session;
    return issued;
  }

  refreshSession(session: MockSession) {
    const csrf = opaqueToken();
    const token = signPayload({ h: session.hash, c: tokenHash("csrf", csrf), exp: session.expiresAt }, this.signingSecret(), `session:${session.scope}`);
    const name = session.scope === "OPERATOR" ? MANUAL_COOKIES.operator : MANUAL_COOKIES.reservation;
    return { csrf, cookie: manualCookie(name, token, session.expiresAt - this.now()) };
  }

  async bootstrap(request: Request, input: unknown) {
    this.assertOrigin(request);
    bootstrapSchema.parse(input);
    const suppliedSecret = request.headers.get("x-manual-test-bootstrap-secret");
    if (suppliedSecret !== null) {
      // This credential belongs only to server-to-server automation. Browser fetch
      // metadata denies this path even for a valid credential and ADMIN cookie.
      const browser = [...request.headers.keys()].some((name) => name.startsWith("sec-fetch-"));
      requireManual(!browser && this.config.syntheticBootstrapSecret && suppliedSecret.length >= 32 && suppliedSecret.length <= 256 && equalHash(tokenHash("bootstrap", suppliedSecret), tokenHash("bootstrap", this.config.syntheticBootstrapSecret)), "UNAUTHORIZED", 401);
    } else {
      requireManual(await this.verifyAdminSession(), "UNAUTHORIZED", 401);
    }
    await this.consumeChallenge(request);
    const run: MockRun = {
      id: randomUUID(), mode: this.db.mode, status: "ACTIVE", expiresAt: this.now() + MOCK_TTL.run,
      sessions: {}, grants: {}, receipts: {}, data: emptyMockData(),
    };
    for (let index = 1; index <= 12; index++) {
      const id = `child-${index}`;
      run.data.children[id] = { id, active: index !== 12 };
    }
    const issued = this.issueSession(run, "OPERATOR");
    await this.db.createRun(run);
    return { runId: run.id, expiresAt: run.expiresAt, mode: run.mode, ...issued };
  }

  async withSession<T>(request: Request, runId: string, scope: MockSession["scope"], operation: (run: MockRun, session: MockSession) => T | Promise<T>): Promise<T> {
    this.assertOrigin(request);
    const name = scope === "OPERATOR" ? MANUAL_COOKIES.operator : MANUAL_COOKIES.reservation;
    const payload = verifyPayload(readManualCookie(request, name), this.signingSecret(), `session:${scope}`, this.now());
    return this.transaction(runId, (run) => {
      const session = run.sessions[payload.h];
      requireManual(run.status === "ACTIVE" && run.expiresAt > this.now() && session && !session.revoked && session.expiresAt > this.now() && session.scope === scope && session.runId === runId, "UNAUTHORIZED", 401);
      if (request.method !== "GET") this.verifyCsrf(request, payload.c);
      return operation(run, session);
    });
  }

  async transaction<T>(runId: string, operation: (run: MockRun) => T | Promise<T>): Promise<T> {
    try { return await this.db.$transaction(runId, (tx) => operation(tx.run)); }
    catch (error) {
      if (error instanceof Error && error.message === "MOCK_RUN_UNAVAILABLE") throw new ManualTestError("UNAUTHORIZED", 401);
      throw error;
    }
  }

  async exchange(request: Request, input: unknown) {
    const body = exchangeSchema.parse(input);
    await this.consumeChallenge(request);
    const hash = tokenHash("grant", body.grant);
    return this.transaction(body.runId, (run) => {
      const grant = run.grants[hash];
      const classRow = grant && run.data.classes[grant.classId];
      requireManual(run.status === "ACTIVE" && run.expiresAt > this.now() && grant && grant.runId === run.id && !grant.consumed && grant.expiresAt > this.now() && classRow?.status === "SCHEDULED" && classRow.startsAt > this.now(), "UNAUTHORIZED", 401);
      grant.consumed = true;
      return { runId: run.id, ...this.issueSession(run, "RESERVATION", grant.classId) };
    });
  }
}
