import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MANUAL_COOKIES, MOCK_TTL, ManualTestAuth, signPayload, tokenHash, verifyPayload } from "@/server/manual-test/auth";
import { ORIGIN, START, SYNTHETIC_SECRET, bootstrap, cookiePair, fixtureClass, request, reservationSession, setup, signedCookiePayload } from "./helpers";

describe("independent mock manual-test authentication", () => {
  it.each([{ enabled: false }, { deploymentEnv: "production" }])("refuses runtime %j", async (config) => {
    await expect(setup(config).auth.issueChallenge(request("GET"))).rejects.toThrow("MOCK_RUNTIME_DISABLED");
  });

  it("denies a mock adapter outside the unit-test environment", async () => {
    const context = setup({ nodeEnv: "production", deploymentEnv: "preview" });
    await expect(context.auth.issueChallenge(request("GET"))).rejects.toThrow("MOCK_RUNTIME_DISABLED");
  });

  it.each(["https://manual.test.evil", "https://manual.test/", "null", "", "https://other.test"])("requires exact configured Origin: %s", async (origin) => {
    await expect(setup().auth.issueChallenge(request("GET", "", "", undefined, { origin }))).rejects.toThrow("ORIGIN_DENIED");
  });

  it("rejects foreign request hosts and cross-site Fetch Metadata", async () => {
    const context = setup();
    await expect(context.auth.issueChallenge(new Request("https://evil.test", { headers: { origin: ORIGIN } }))).rejects.toThrow("ORIGIN_DENIED");
    await expect(context.auth.issueChallenge(request("GET", "", "", undefined, { "sec-fetch-site": "cross-site" }))).rejects.toThrow("ORIGIN_DENIED");
  });

  it("accepts browser same-origin GET without Origin, while preserving strict write Origin", async () => {
    const auth = setup().auth;
    const get = new Request(`${ORIGIN}/api/manual-test/csrf`, { headers: { "sec-fetch-site": "same-origin" } });
    expect((await auth.issueChallenge(get)).csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(() => auth.assertOrigin(new Request(`${ORIGIN}/api/manual-test/bootstrap`, { method: "POST", headers: { "sec-fetch-site": "same-origin" } }))).toThrow("ORIGIN_DENIED");
  });

  it.each([undefined, "none", "cross-site", "same-site"])("rejects absent GET Origin with Fetch Metadata %s", async (site) => {
    const headers = site ? { "sec-fetch-site": site } : undefined;
    await expect(setup().auth.issueChallenge(new Request(`${ORIGIN}/api/manual-test/csrf`, { headers }))).rejects.toThrow("ORIGIN_DENIED");
  });

  it.each(["", "null", "https://evil.test"])("never overrides present wrong Origin %s with same-origin metadata", async (origin) => {
    await expect(setup().auth.issueChallenge(new Request(`${ORIGIN}/api/manual-test/csrf`, { headers: { origin, "sec-fetch-site": "same-origin" } }))).rejects.toThrow("ORIGIN_DENIED");
  });

  it("rejects absent-Origin same-origin metadata when URL host differs", async () => {
    await expect(setup().auth.issueChallenge(new Request("https://evil.test/api/manual-test/csrf", { headers: { "sec-fetch-site": "same-origin" } }))).rejects.toThrow("ORIGIN_DENIED");
  });

  it("public challenge exposes no bootstrap authority, is one-use, and requires secret + CSRF until expiry", async () => {
    const context = setup();
    const challenge = await context.auth.issueChallenge(request("GET"));
    expect(JSON.stringify(challenge)).not.toContain(SYNTHETIC_SECRET);
    const cookie = cookiePair(challenge.cookie);
    const valid = { "x-manual-test-bootstrap-secret": SYNTHETIC_SECRET };
    await expect(context.auth.bootstrap(request("POST", cookie, challenge.csrf, undefined, { "x-manual-test-bootstrap-secret": "incorrect-synthetic-secret-0000000000" }), {})).rejects.toThrow("UNAUTHORIZED");
    await expect(context.auth.bootstrap(request("POST", cookie, "", undefined, valid), {})).rejects.toThrow("CSRF_DENIED");
    await context.auth.bootstrap(request("POST", cookie, challenge.csrf, undefined, valid), {});
    // The same challenge + CSRF pair cannot be replayed for a second bootstrap.
    await expect(context.auth.bootstrap(request("POST", cookie, challenge.csrf, undefined, valid), {})).rejects.toThrow("CHALLENGE_REUSED");
    // An expired challenge is rejected as UNAUTHORIZED before the replay check.
    const fresh = await context.auth.issueChallenge(request("GET"));
    const freshCookie = cookiePair(fresh.cookie);
    context.clock.now += MOCK_TTL.challenge;
    await expect(context.auth.bootstrap(request("POST", freshCookie, fresh.csrf, undefined, valid), {})).rejects.toThrow("UNAUTHORIZED");
  });

  it("uses __Host secure independent cookies and stores only domain-separated hashes", async () => {
    const context = setup();
    const operator = await bootstrap(context);
    const cookieToken = operator.cookie.split("=")[1];
    const snapshot = await context.db.$transaction(operator.runId, (tx) => tx.run);
    expect(JSON.stringify(snapshot)).not.toContain(cookieToken);
    expect(JSON.stringify(snapshot)).not.toContain(operator.csrf);
    expect(Object.keys(snapshot.sessions)).toEqual([operator.sessionHash]);
    expect(signedCookiePayload(operator.cookie, "session:OPERATOR")).toMatchObject({ h: operator.sessionHash, c: tokenHash("csrf", operator.csrf), exp: snapshot.sessions[operator.sessionHash].expiresAt });
    const { classId } = await fixtureClass(context, operator);
    const reservation = await reservationSession(context, operator, classId);
    expect(reservation.cookie).toMatch(new RegExp(`^${MANUAL_COOKIES.reservation}=`));
    const challenge = await context.auth.issueChallenge(request("GET"));
    for (const attribute of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]) expect(challenge.cookie).toContain(attribute);
    expect(challenge.cookie).not.toContain("Domain=");
  });

  it("rejects ADMIN/E2E cookies, forged tokens, missing CSRF and run substitution", async () => {
    const context = setup();
    const first = await bootstrap(context);
    const second = await bootstrap(context);
    for (const cookie of ["authjs.session-token=admin; e2e=lease", `${MANUAL_COOKIES.operator}=${"a".repeat(43)}`, `${first.cookie}; ${first.cookie}`]) {
      await expect(context.flow.revenue(request("GET", cookie), first.runId)).rejects.toThrow("UNAUTHORIZED");
    }
    await expect(context.flow.createGrant(request("POST", first.cookie), { runId: first.runId, classId: randomUUID() })).rejects.toThrow("CSRF_DENIED");
    await expect(context.flow.revenue(first.get(), second.runId)).rejects.toThrow("UNAUTHORIZED");
    await expect(context.flow.revenue(first.get(), randomUUID())).rejects.toThrow("UNAUTHORIZED");
  });

  it("denies session expiry, run expiry and explicit revocation", async () => {
    const context = setup();
    const operator = await bootstrap(context);
    context.clock.now += MOCK_TTL.session;
    await expect(context.flow.revenue(operator.get(), operator.runId)).rejects.toThrow("UNAUTHORIZED");
    context.clock.now -= MOCK_TTL.session;
    await context.db.$transaction(operator.runId, (tx) => { tx.run.expiresAt = context.clock.now; });
    await expect(context.flow.revenue(operator.get(), operator.runId)).rejects.toThrow("UNAUTHORIZED");
    await context.db.$transaction(operator.runId, (tx) => {
      tx.run.expiresAt = context.clock.now + 1;
      Object.values(tx.run.sessions)[0].revoked = true;
    });
    await expect(context.flow.revenue(operator.get(), operator.runId)).rejects.toThrow("UNAUTHORIZED");
  });

  it("verifies challenges and sessions across independent auth instances without challenge storage or persisted CSRF", async () => {
    const context = setup();
    const other = new ManualTestAuth(context.db, { enabled: true, nodeEnv: "test", origin: ORIGIN, syntheticBootstrapSecret: SYNTHETIC_SECRET }, () => context.clock.now);
    const challenge = await context.auth.issueChallenge(request("GET"));
    const operator = await other.bootstrap(request("POST", cookiePair(challenge.cookie), challenge.csrf, undefined, { "x-manual-test-bootstrap-secret": SYNTHETIC_SECRET }), {});
    await context.db.$transaction(operator.runId, (tx) => {
      for (const session of Object.values(tx.run.sessions)) delete session.csrfHash;
    });
    await expect(context.auth.withSession(request("POST", cookiePair(operator.cookie), operator.csrf), operator.runId, "OPERATOR", () => "accepted")).resolves.toBe("accepted");
  });

  it("refreshes signed cookies without changing session bindings or extending expiry", async () => {
    const context = setup();
    const operator = await bootstrap(context);
    const { classId } = await fixtureClass(context, operator);
    const reservation = await reservationSession(context, operator, classId);
    const submitted = await context.flow.submit(reservation.post(), { runId: operator.runId, childId: "child-1" });
    const previous = signedCookiePayload(reservation.cookie, "session:RESERVATION");
    context.clock.now += 1_000;
    const refreshed = await context.flow.session(reservation.get(), operator.runId, "RESERVATION");
    const payload = signedCookiePayload(refreshed.cookie, "session:RESERVATION", context.clock.now);
    expect(payload.h).toBe(previous.h);
    expect(payload.exp).toBe(previous.exp);
    expect(payload.c).not.toBe(previous.c);
    expect(refreshed).toMatchObject({ applications: [{ id: submitted.applicationId, childId: "child-1", status: "PENDING" }] });
    const cookie = cookiePair(refreshed.cookie);
    await expect(context.auth.withSession(request("POST", cookie, reservation.csrf), operator.runId, "RESERVATION", () => true)).rejects.toThrow("CSRF_DENIED");
    await expect(context.auth.withSession(request("POST", cookie, refreshed.csrf), operator.runId, "RESERVATION", (_run, session) => session.classId)).resolves.toBe(classId);
  });

  it("rejects tampering, wrong secrets, malformed payloads, expiry and token-purpose swaps", async () => {
    const payload = { h: "a".repeat(64), c: "b".repeat(64), exp: START + MOCK_TTL.session };
    const token = signPayload(payload, SYNTHETIC_SECRET, "session:OPERATOR");
    expect(verifyPayload(token, SYNTHETIC_SECRET, "session:OPERATOR", START)).toEqual(payload);
    const [encoded, signature] = token.split(".");
    const tampered = Buffer.from(JSON.stringify({ ...payload, exp: payload.exp + 1 })).toString("base64url");
    for (const invalid of ["", "a".repeat(513), `${encoded}.short`, `${encoded}.${signature}.extra`, `${tampered}.${signature}`, `${encoded}.${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`]) {
      expect(() => verifyPayload(invalid, SYNTHETIC_SECRET, "session:OPERATOR", START)).toThrow("UNAUTHORIZED");
    }
    expect(() => verifyPayload(token, "different-server-secret-00000000000000", "session:OPERATOR", START)).toThrow("UNAUTHORIZED");
    expect(() => verifyPayload(token, SYNTHETIC_SECRET, "challenge", START)).toThrow("UNAUTHORIZED");
    expect(() => verifyPayload(token, SYNTHETIC_SECRET, "session:RESERVATION", START)).toThrow("UNAUTHORIZED");
    expect(() => verifyPayload(token, SYNTHETIC_SECRET, "session:OPERATOR", payload.exp)).toThrow("UNAUTHORIZED");
    for (const value of ["not json", JSON.stringify({ ...payload, c: "invalid" }), JSON.stringify({ ...payload, exp: 1.5 }), JSON.stringify({ ...payload, extra: true })]) {
      const encoded = Buffer.from(value).toString("base64url");
      const signature = createHmac("sha256", SYNTHETIC_SECRET).update(`yaho-manual-test:session:OPERATOR\0${encoded}`).digest("base64url");
      expect(() => verifyPayload(`${encoded}.${signature}`, SYNTHETIC_SECRET, "session:OPERATOR", START)).toThrow("UNAUTHORIZED");
    }
  });

  it("fails closed without a stable server signing secret", async () => {
    vi.stubEnv("AUTH_SECRET", undefined);
    try {
      await expect(setup({ syntheticBootstrapSecret: undefined }).auth.issueChallenge(request("GET"))).rejects.toThrow("MOCK_RUNTIME_DISABLED");
    } finally { vi.unstubAllEnvs(); }
  });

  it("rejects challenge replay on exchange", async () => {
    const context = setup();
    const operator = await bootstrap(context);
    const { classId } = await fixtureClass(context, operator);
    const link = await context.flow.createGrant(operator.post(), { runId: operator.runId, classId });
    const challenge = await context.auth.issueChallenge(request("GET"));
    const requestWith = (csrf: string) => request("POST", cookiePair(challenge.cookie), csrf);
    await context.auth.exchange(requestWith(challenge.csrf), { runId: operator.runId, grant: link.grant });
    await expect(context.auth.exchange(requestWith(challenge.csrf), { runId: operator.runId, grant: link.grant })).rejects.toThrow("CHALLENGE_REUSED");
  });

  it("limits challenge issuance to 120 per rolling 60 seconds", async () => {
    const context = setup();
    for (let index = 0; index < 120; index++) await context.auth.issueChallenge(request("GET"));
    await expect(context.auth.issueChallenge(request("GET"))).rejects.toThrow("RATE_LIMITED");
    context.clock.now += 60_000;
    await expect(context.auth.issueChallenge(request("GET"))).resolves.toHaveProperty("csrf");
  });

  it("consumes one-use grants atomically across concurrent exchanges", async () => {
    const context = setup();
    const operator = await bootstrap(context);
    const { classId } = await fixtureClass(context, operator);
    const link = await context.flow.createGrant(operator.post(), { runId: operator.runId, classId });
    const challenges = await Promise.all([context.auth.issueChallenge(request("GET")), context.auth.issueChallenge(request("GET"))]);
    const outcomes = await Promise.allSettled(challenges.map((challenge) => context.auth.exchange(request("POST", cookiePair(challenge.cookie), challenge.csrf), { runId: operator.runId, grant: link.grant })));
    expect(outcomes.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((row) => row.status === "rejected")).toHaveLength(1);
    const snapshot = await context.db.$transaction(operator.runId, (tx) => tx.run);
    expect(JSON.stringify(snapshot)).not.toContain(link.grant);
  });

  it("rejects expired and cross-run grants without granting a reservation session", async () => {
    const context = setup();
    const first = await bootstrap(context);
    const second = await bootstrap(context);
    const { classId } = await fixtureClass(context, first);
    const link = await context.flow.createGrant(first.post(), { runId: first.runId, classId });
    const exchange = async (runId: string) => {
      const challenge = await context.auth.issueChallenge(request("GET"));
      return context.auth.exchange(request("POST", cookiePair(challenge.cookie), challenge.csrf), { runId, grant: link.grant });
    };
    await expect(exchange(second.runId)).rejects.toThrow("UNAUTHORIZED");
    context.clock.now += MOCK_TTL.grant;
    await expect(exchange(first.runId)).rejects.toThrow("UNAUTHORIZED");
  });
});
