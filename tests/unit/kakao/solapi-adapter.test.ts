import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SolapiAdapter, buildSolapiAuthorization, type SolapiTransport } from "@/lib/kakao/providers/solapi";
import { buildOutboxInput } from "@/lib/kakao/outbox";
import { InMemoryOutboxStore } from "@/lib/kakao/outbox-store";
import { processOutboxBatch } from "@/lib/kakao/outbox-worker";
import { InMemoryDispatchRepository, type CoreState } from "@/server/kakao/dispatch-repository";

// V8(i): block the global fetch inside this file so a future direct fetch()
// call fails loudly instead of reaching the network. Mock Transports only.
const originalFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("global fetch is blocked in this test file (use an injected Transport)");
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

const CLOCK = { now: () => new Date("2026-11-07T06:00:00.000Z"), randomBytes: () => Buffer.from("0123456789abcdef0123456789abcdef", "hex") };
const REAL_REF = "M4V20240525163506DRKMPITQDY5Q6F";
const FAILED_REF = "M4V20240525163506CQKNPHTPCX4P5E";
const GROUP_ID = "G4V20240525163506ABCDEFGHIJKLMNO";

const realPermit = {
  dispatchId: "d1", slotId: "s1", claimToken: "c1", providerId: "solapi" as const,
  context: {
    event: "application.received" as const, audience: "admin" as const,
    dedupeKey: `application.received:${"a".repeat(64)}`,
    recipientId: "r1", recipientVersion: "v1",
    submittedAt: new Date("2026-10-28T00:00:00Z"),
    templateId: "KA01TP2301260109382045fWJtLZUIab", templateVersion: "v1",
    variables: { 접수시각: "2026-10-28 09:00" },
  },
};
const syntheticPermit = {
  ...realPermit,
  context: { ...realPermit.context, templateId: "mock_application_received_v1" as const, templateVersion: "g2-v1" as const },
};

type RecordedCall = { url: string; init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal } };
function recordingTransport(response: { status: number; body: unknown; headers?: Record<string, string> }): { transport: SolapiTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    transport: {
      async fetch(url, init) {
        calls.push({ url, init });
        return { status: response.status, headers: { get: (name: string) => response.headers?.[name.toLowerCase()] ?? null }, json: async () => response.body };
      },
    },
  };
}
function makeAdapter(transport: SolapiTransport, overrides: Record<string, unknown> = {}) {
  return new SolapiAdapter({
    transport,
    apiKey: "test-api-key",
    apiSecret: "test-api-secret",
    pfId: "KA01PF1234567890abcdef",
    templateId: "KA01TP2301260109382045fWJtLZUIab",
    to: "010-1234-5678",
    clock: CLOCK,
    ...overrides,
  });
}
function acceptedBody(messageId = REAL_REF, statusCode = "2000") {
  return {
    groupInfo: { groupId: GROUP_ID, accountId: "acc", apiVersion: "4", status: "SENDING", count: { total: 1, registeredSuccess: 1, registeredFailed: 0, sentTotal: 0, sentSuccess: 0, sentFailed: 0, sentPending: 0, sentReplacement: 0, refund: 0 }, countForCharge: { ata: { "82": 0 } }, balance: {}, price: {}, dateSent: "2026-11-07T06:00:00.000Z", dateCreated: "2026-11-07T06:00:00.000Z", dateCompleted: null },
    failedMessageList: [],
    messageList: [{ to: "01012345678", type: "ATA", country: "82", messageId, statusCode, statusMessage: "정상 접수", accountId: "acc" }],
  };
}
function failedBody(statusCode: string, statusMessage = "x") {
  return {
    groupInfo: { groupId: GROUP_ID, status: "SENDING" },
    failedMessageList: [{ to: "01012345678", type: "ATA", country: "82", messageId: FAILED_REF, statusCode, statusMessage, accountId: "acc" }],
    messageList: [],
  };
}

describe("SolapiAdapter HMAC", () => {
  it("signs with HMAC-SHA256 over date + salt (Python hmac vectors)", () => {
    expect(buildSolapiAuthorization({ apiKey: "test-api-key", apiSecret: "test-api-secret", date: "2026-11-07T06:00:00.000Z", salt: "0123456789abcdef0123456789abcdef" }))
      .toBe("HMAC-SHA256 apiKey=test-api-key, date=2026-11-07T06:00:00.000Z, salt=0123456789abcdef0123456789abcdef, signature=c20eeed6621015e0a53e8022c2d60bb33e2679f250264e67c26affb59034cb43");
    expect(buildSolapiAuthorization({ apiKey: "k", apiSecret: "another-synthetic-secret", date: "2026-01-01T00:00:00.000Z", salt: "abcdef0123456789abcdef0123456789" }))
      .toBe("HMAC-SHA256 apiKey=k, date=2026-01-01T00:00:00.000Z, salt=abcdef0123456789abcdef0123456789, signature=b1906f3d1cfa63963d08ae0df3deffc2e81572d3dd6707074f7140957c4f0664");
    expect(buildSolapiAuthorization({ apiKey: "test-api-key", apiSecret: "test-api-secret", date: "2026-11-07T06:00:00.000Z", salt: "ffffffffffffffffffffffffffffffff" }))
      .toBe("HMAC-SHA256 apiKey=test-api-key, date=2026-11-07T06:00:00.000Z, salt=ffffffffffffffffffffffffffffffff, signature=bd056e2d20079b254f7f71de1b9fe91736a8416dab047b25e1823aab9e74c464");
  });
});

describe("SolapiAdapter request", () => {
  it("sends exactly the specified ATA body with no text/from and normalises the recipient", async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: acceptedBody() });
    const result = await makeAdapter(transport).send(realPermit);
    expect(result).toEqual({ status: "accepted", providerId: "solapi", ref: REAL_REF, phase: "awaiting_final" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.solapi.com/messages/v4/send-many/detail");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers["Content-Type"]).toBe("application/json");
    expect(calls[0]!.init.headers["Authorization"]).toBe("HMAC-SHA256 apiKey=test-api-key, date=2026-11-07T06:00:00.000Z, salt=0123456789abcdef0123456789abcdef, signature=c20eeed6621015e0a53e8022c2d60bb33e2679f250264e67c26affb59034cb43");
    expect(JSON.parse(calls[0]!.init.body)).toEqual({
      messages: [{ to: "01012345678", type: "ATA", country: "82", kakaoOptions: { pfId: "KA01PF1234567890abcdef", templateId: "KA01TP2301260109382045fWJtLZUIab", variables: { "#{접수시각}": "2026-10-28 09:00" }, disableSms: true } }],
      strict: true,
      allowDuplicates: false,
      showMessageList: true,
    });
    expect(calls[0]!.init.body).not.toContain("\"text\"");
    expect(calls[0]!.init.body).not.toContain("\"from\"");
  });

  it("strips spaces as well as hyphens from the recipient number", async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: acceptedBody() });
    await makeAdapter(transport, { to: "010 1234 5678" }).send(realPermit);
    expect(JSON.parse(calls[0]!.init.body).messages[0].to).toBe("01012345678");
  });
});

describe("SolapiAdapter response mapping", () => {
  it.each(["1010", "1011", "1042", "1043", "1057", "1157", "3010", "3013", "3103", "3105", "3117", "1026", "1030", "1031", "3107", "3108", "3040", "3063"])(
    "maps failedMessageList code %s to definite_rejection",
    async (code) => {
      const statusMessage = code === "3040" ? "등록되지 않은 발신번호입니다." : "x";
      const { transport, calls } = recordingTransport({ status: 200, body: failedBody(code, statusMessage) });
      const result = await makeAdapter(transport).send(realPermit);
      expect(result).toEqual({ status: "definite_rejection", retryable: false, nonBillableEvidence: false });
      expect(calls).toHaveLength(1);
    },
  );

  it("maps failed code 1069 to unknown (F-2: removed from DEFINITE_REJECTION_CODES)", async () => {
    const { transport } = recordingTransport({ status: 200, body: failedBody("1069") });
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "unknown", code: "provider_result_unknown" });
  });

  it("maps an unmapped failed code to unknown", async () => {
    const { transport } = recordingTransport({ status: 200, body: failedBody("9999") });
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "unknown", code: "provider_result_unknown" });
  });

  it("maps a non-2000 messageList code to unknown", async () => {
    const { transport } = recordingTransport({ status: 200, body: acceptedBody(REAL_REF, "3000") });
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "unknown", code: "provider_result_unknown" });
  });

  it("maps an invalid messageId ref to unknown", async () => {
    const { transport } = recordingTransport({ status: 200, body: acceptedBody("M4Vshort", "2000") });
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "unknown", code: "provider_result_unknown" });
  });

  it("accepts a 1-item messageList by position even when its `to` differs (F-1: `to` is not matched)", async () => {
    const body = acceptedBody();
    body.messageList[0]!.to = "01099999999";
    const { transport } = recordingTransport({ status: 200, body });
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "accepted", providerId: "solapi", ref: REAL_REF, phase: "awaiting_final" });
  });

  it("maps a body without groupInfo to unknown", async () => {
    const { messageList } = acceptedBody();
    const { transport } = recordingTransport({ status: 200, body: { messageList } });
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "unknown", code: "provider_result_unknown" });
  });

  it("maps HTTP 403 to provider_auth_error", async () => {
    const { transport, calls } = recordingTransport({ status: 403, body: { errorCode: "InvalidAPIKey", errorMessage: "x" } });
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "unknown", code: "provider_auth_error" });
    expect(calls).toHaveLength(1);
  });

  it("maps HTTP 429 to provider_rate_limited", async () => {
    const { transport, calls } = recordingTransport({ status: 429, body: { errorCode: "TooManyRequests", message: "x" }, headers: { "x-retry-after": "5" } });
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "unknown", code: "provider_rate_limited" });
    expect(calls).toHaveLength(1);
  });

  it("maps HTTP 500 to provider_error without retrying", async () => {
    const { transport, calls } = recordingTransport({ status: 500, body: {} });
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "unknown", code: "provider_error" });
    expect(calls).toHaveLength(1);
  });

  it("maps other HTTP 4xx to provider_result_unknown", async () => {
    const { transport, calls } = recordingTransport({ status: 404, body: {} });
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "unknown", code: "provider_result_unknown" });
    expect(calls).toHaveLength(1);
  });

  it("maps a transport throw to provider_error without retrying", async () => {
    const calls: RecordedCall[] = [];
    const transport: SolapiTransport = { async fetch(url, init) { calls.push({ url, init }); throw new Error("boom"); } };
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "unknown", code: "provider_error" });
    expect(calls).toHaveLength(1);
  });

  it("maps a timeout to provider_timeout after exactly one transport call", async () => {
    const calls: RecordedCall[] = [];
    const transport: SolapiTransport = {
      fetch(url, init) {
        calls.push({ url, init });
        return new Promise((_resolve, reject) => { init.signal?.addEventListener("abort", () => reject(new Error("aborted"))); });
      },
    };
    await expect(makeAdapter(transport, { timeoutMs: 50 }).send(realPermit)).resolves.toEqual({ status: "unknown", code: "provider_timeout" });
    expect(calls).toHaveLength(1);
  });
});

describe("SolapiAdapter F-1 messageList position matching", () => {
  function f1Body(messageList: unknown[]) {
    return { groupInfo: { groupId: GROUP_ID, status: "SENDING" }, failedMessageList: [], messageList };
  }

  it("accepts a 1-item messageList WITHOUT `to` (ref = messageId, 31-char M4V)", async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: f1Body([{ messageId: REAL_REF, statusCode: "2000", statusMessage: "정상 접수" }]) });
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "accepted", providerId: "solapi", ref: REAL_REF, phase: "awaiting_final" });
    expect(REAL_REF).toHaveLength(31);
    expect(calls).toHaveLength(1);
  });

  it("maps a 0-item messageList to unknown/provider_result_unknown", async () => {
    const { transport } = recordingTransport({ status: 200, body: f1Body([]) });
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "unknown", code: "provider_result_unknown" });
  });

  it("maps a 2-item messageList to unknown/provider_result_unknown", async () => {
    const { transport } = recordingTransport({ status: 200, body: f1Body([
      { to: "01012345678", messageId: REAL_REF, statusCode: "2000" },
      { to: "01012345678", messageId: FAILED_REF, statusCode: "2000" },
    ]) });
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "unknown", code: "provider_result_unknown" });
  });

  it("accepts a 1-item messageList WITH `to`", async () => {
    const { transport } = recordingTransport({ status: 200, body: acceptedBody() });
    await expect(makeAdapter(transport).send(realPermit)).resolves.toEqual({ status: "accepted", providerId: "solapi", ref: REAL_REF, phase: "awaiting_final" });
  });
});

describe("SolapiAdapter guards", () => {
  it("does not call the transport for an invalid permit", async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: acceptedBody() });
    await expect(makeAdapter(transport).send({})).resolves.toEqual({ status: "unknown" });
    expect(calls).toHaveLength(0);
  });

  it("does not call the transport for a synthetic context", async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: acceptedBody() });
    await expect(makeAdapter(transport).send(syntheticPermit)).resolves.toEqual({ status: "unknown", code: "provider_config_error" });
    expect(calls).toHaveLength(0);
  });

  it("does not call the transport when the templateId does not match the config", async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: acceptedBody() });
    await expect(makeAdapter(transport, { templateId: "KA01TP0000000000000000000000000000" }).send(realPermit)).resolves.toEqual({ status: "unknown", code: "provider_config_error" });
    expect(calls).toHaveLength(0);
  });

  it("does not call the transport for an invalid recipient number", async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: acceptedBody() });
    await expect(makeAdapter(transport, { to: "010-ABC" }).send(realPermit)).resolves.toEqual({ status: "unknown", code: "recipient_invalid" });
    expect(calls).toHaveLength(0);
  });

  it("throws when constructed without real settings", () => {
    const { transport } = recordingTransport({ status: 200, body: acceptedBody() });
    expect(() => makeAdapter(transport, { apiKey: "" })).toThrow();
    expect(() => makeAdapter(transport, { apiSecret: "" })).toThrow();
    expect(() => makeAdapter(transport, { pfId: "" })).toThrow();
    expect(() => makeAdapter(transport, { templateId: "" })).toThrow();
    expect(() => makeAdapter(transport, { to: "" })).toThrow();
    expect(() => makeAdapter(undefined as unknown as SolapiTransport)).toThrow();
  });
});

describe("SolapiAdapter worker guard (V7b, G4 step 4)", () => {
  it("is accepted by the worker gate but fails closed without a real prepare", async () => {
    const at = new Date("2026-10-28T00:00:00Z");
    const state: CoreState = { outboxes: [], dispatches: [], slots: [], audits: [], recipients: [], runtime: null, lookupApprovals: [], lookups: [], closureApprovals: [], purgeApprovals: [], costApprovals: [], monthlyAdditionalCosts: {} };
    const repository = new InMemoryDispatchRepository(state);
    const store = new InMemoryOutboxStore(repository);
    const input = buildOutboxInput("application.received", `c${"3".repeat(24)}`, "created", "admin", at);
    await store.enqueue(input);
    const { transport, calls } = recordingTransport({ status: 200, body: acceptedBody() });
    const adapter = makeAdapter(transport);
    // G4 step 4 accepts SolapiAdapter at the worker gate; the real prepare
    // (buildRealSafe) is what gates an actual send. A bare adapter whose
    // prepare fails still fails closed with no transport call.
    const safe = {
      repository,
      provider: adapter,
      clock: () => at,
      prepare: async () => { throw new Error("prepare must not run"); },
    };
    await expect(processOutboxBatch(store, { provider: null, now: at, safe })).resolves.toMatchObject({ outcomes: [{ status: "failed", reason: "store_error" }] });
    expect(calls).toHaveLength(0);
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "processing", attemptCount: 0 });
  });
});
