import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SolapiLookupClient } from "@/server/kakao/lookup/solapi";
import type { SolapiTransport } from "@/lib/kakao/providers/solapi";

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
const GROUP_ID = "G4V20240525163506ABCDEFGHIJKLMNO";

type RecordedCall = { url: string; init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal } };
function recordingTransport(response: { status: number; body: unknown }): { transport: SolapiTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    transport: {
      async fetch(url, init) {
        calls.push({ url, init });
        return { status: response.status, json: async () => response.body };
      },
    },
  };
}
function makeClient(transport: SolapiTransport, overrides: Record<string, unknown> = {}) {
  return new SolapiLookupClient({ transport, apiKey: "test-api-key", apiSecret: "test-api-secret", clock: CLOCK, ...overrides });
}
function listBody(entry: Record<string, unknown> | null, messageId = REAL_REF) {
  return { messageList: entry ? { [messageId]: entry } : {} };
}
function listEntry(statusCode: string | null) {
  return { messageId: REAL_REF, statusCode, statusMessage: "x", status: "COMPLETE" };
}
function groupBody() {
  return { groupInfo: { groupId: GROUP_ID, status: "SENDING", count: { sentSuccess: 0, sentFailed: 0, sentPending: 1, sentReplacement: 0, refund: 0, registeredSuccess: 1, registeredFailed: 0 } } };
}

describe("SolapiLookupClient.lookupByMessageId", () => {
  it("queries by messagesId and parses the object-form messageList", async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: listBody(listEntry("4000")) });
    const result = await makeClient(transport).lookupByMessageId(REAL_REF);
    expect(result).toEqual({ status: "delivered", ref: REAL_REF });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://api.solapi.com/messages/v4/list?messagesId=${REAL_REF}`);
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.init.headers["Authorization"]).toMatch(/^HMAC-SHA256 apiKey=test-api-key, date=2026-11-07T06:00:00\.000Z, salt=0123456789abcdef0123456789abcdef, signature=[0-9a-f]{64}$/);
  });

  it.each([
    ["4000", "delivered"],
    ["2000", "unknown"],
    ["3000", "unknown"],
    ["3001", "delivery_failed"],
    ["3014", "unknown"],
    ["3048", "unknown"],
    ["3999", "delivery_failed"],
    ["1000", "unknown"],
    ["2001", "unknown"],
    ["9999", "unknown"],
    [null, "unknown"],
  ] as const)("maps statusCode %s to %s", async (statusCode, expected) => {
    const { transport } = recordingTransport({ status: 200, body: listBody(listEntry(statusCode)) });
    await expect(makeClient(transport).lookupByMessageId(REAL_REF)).resolves.toEqual({ status: expected, ref: REAL_REF });
  });

  it("returns null when the entry is missing", async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: listBody(null) });
    await expect(makeClient(transport).lookupByMessageId(REAL_REF)).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("returns null when the entry messageId does not match", async () => {
    const { transport } = recordingTransport({ status: 200, body: listBody({ messageId: "M4V20240525163506AAAAAAAAAAAAAAAA", statusCode: "4000" }) });
    await expect(makeClient(transport).lookupByMessageId(REAL_REF)).resolves.toBeNull();
  });

  it("returns null for an array-form messageList", async () => {
    const { transport } = recordingTransport({ status: 200, body: { messageList: [listEntry("4000")] } });
    await expect(makeClient(transport).lookupByMessageId(REAL_REF)).resolves.toBeNull();
  });

  it("returns null on HTTP error, transport throw, timeout, and malformed body", async () => {
    const { transport: errorTransport } = recordingTransport({ status: 500, body: {} });
    await expect(makeClient(errorTransport).lookupByMessageId(REAL_REF)).resolves.toBeNull();
    const throwing: SolapiTransport = { async fetch() { throw new Error("boom"); } };
    await expect(makeClient(throwing).lookupByMessageId(REAL_REF)).resolves.toBeNull();
    const hanging: SolapiTransport = { fetch(_url, init) { return new Promise((_resolve, reject) => { init.signal?.addEventListener("abort", () => reject(new Error("aborted"))); }); } };
    await expect(makeClient(hanging, { timeoutMs: 50 }).lookupByMessageId(REAL_REF)).resolves.toBeNull();
    const { transport: badBody } = recordingTransport({ status: 200, body: { nope: true } });
    await expect(makeClient(badBody).lookupByMessageId(REAL_REF)).resolves.toBeNull();
  });

  it("does not call the transport for an invalid messageId", async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: listBody(listEntry("4000")) });
    await expect(makeClient(transport).lookupByMessageId("short")).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("queries a synthetic ref the same way (union ref)", async () => {
    const syntheticRef = `g2ref_${"a".repeat(32)}`;
    const { transport, calls } = recordingTransport({ status: 200, body: listBody({ messageId: syntheticRef, statusCode: "4000", statusMessage: "x", status: "COMPLETE" }, syntheticRef) });
    await expect(makeClient(transport).lookupByMessageId(syntheticRef)).resolves.toEqual({ status: "delivered", ref: syntheticRef });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("messagesId=g2ref_");
  });
});

describe("SolapiLookupClient.lookupGroup", () => {
  it("returns the group summary", async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: groupBody() });
    await expect(makeClient(transport).lookupGroup(GROUP_ID)).resolves.toEqual({
      groupId: GROUP_ID,
      status: "SENDING",
      counts: { sentSuccess: 0, sentFailed: 0, sentPending: 1, sentReplacement: 0, refund: 0, registeredSuccess: 1, registeredFailed: 0 },
    });
    expect(calls[0]!.url).toBe(`https://api.solapi.com/messages/v4/groups/${GROUP_ID}`);
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("does not call the transport for an invalid groupId", async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: groupBody() });
    await expect(makeClient(transport).lookupGroup("G4Vshort")).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null on HTTP error and malformed body", async () => {
    const { transport: errorTransport } = recordingTransport({ status: 404, body: {} });
    await expect(makeClient(errorTransport).lookupGroup(GROUP_ID)).resolves.toBeNull();
    const { transport: badBody } = recordingTransport({ status: 200, body: { groupInfo: { groupId: GROUP_ID } } });
    await expect(makeClient(badBody).lookupGroup(GROUP_ID)).resolves.toBeNull();
  });
});

describe("SolapiLookupClient.lookup", () => {
  it("delegates to lookupByMessageId using only the ref", async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: listBody(listEntry("4000")) });
    await expect(makeClient(transport).lookup({ lookupId: "l1", slotId: "s1", ref: REAL_REF })).resolves.toEqual({ status: "delivered", ref: REAL_REF });
    expect(calls).toHaveLength(1);
    await expect(makeClient(transport).lookup({ nope: true })).resolves.toBeNull();
  });

  it("throws when constructed without real settings", () => {
    const { transport } = recordingTransport({ status: 200, body: listBody(listEntry("4000")) });
    expect(() => makeClient(transport, { apiKey: "" })).toThrow();
    expect(() => makeClient(undefined as unknown as SolapiTransport)).toThrow();
  });
});
