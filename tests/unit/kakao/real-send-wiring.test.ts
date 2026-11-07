import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRealLookupClient, createRealSolapiTransport, readRealSendEnv } from "@/server/kakao/real-send-wiring";
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

function validEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    KAKAO_SOLAPI_API_KEY: "test-api-key",
    KAKAO_SOLAPI_API_SECRET: "test-api-secret",
    KAKAO_ALIMTALK_PF_ID: "KA01PF1234567890abcdef",
    KAKAO_ALIMTALK_TEMPLATE_ID: "KA01TP2301260109382045fWJtLZUIab",
    KAKAO_RECIPIENT_KEY: Buffer.alloc(32, 9).toString("base64"),
  };
}

describe("readRealSendEnv", () => {
  it("returns all five fields for a valid env", () => {
    const env = readRealSendEnv(validEnv());
    expect(env).not.toBeNull();
    expect(env!.apiKey).toBe("test-api-key");
    expect(env!.apiSecret).toBe("test-api-secret");
    expect(env!.pfId).toBe("KA01PF1234567890abcdef");
    expect(env!.templateId).toBe("KA01TP2301260109382045fWJtLZUIab");
    expect(env!.recipientKey).toEqual(Buffer.alloc(32, 9));
  });
  it.each(["KAKAO_SOLAPI_API_KEY", "KAKAO_SOLAPI_API_SECRET", "KAKAO_ALIMTALK_PF_ID", "KAKAO_ALIMTALK_TEMPLATE_ID", "KAKAO_RECIPIENT_KEY"])("returns null when %s is missing", (name) => {
    const env = validEnv();
    delete env[name];
    expect(readRealSendEnv(env)).toBeNull();
  });
  it.each(["KAKAO_SOLAPI_API_KEY", "KAKAO_SOLAPI_API_SECRET", "KAKAO_ALIMTALK_PF_ID", "KAKAO_ALIMTALK_TEMPLATE_ID", "KAKAO_RECIPIENT_KEY"])("returns null when %s is empty", (name) => {
    expect(readRealSendEnv({ ...validEnv(), [name]: "" })).toBeNull();
  });
  it.each([
    ["KAKAO_SOLAPI_API_KEY", "x".repeat(129)],
    ["KAKAO_SOLAPI_API_SECRET", "x".repeat(257)],
    ["KAKAO_ALIMTALK_PF_ID", "x".repeat(129)],
    ["KAKAO_ALIMTALK_TEMPLATE_ID", "x".repeat(129)],
  ])("returns null when %s exceeds its length limit", (name, value) => {
    expect(readRealSendEnv({ ...validEnv(), [name]: value })).toBeNull();
  });
  it("returns null when the recipient key is not 32 bytes after base64 decoding", () => {
    expect(readRealSendEnv({ ...validEnv(), KAKAO_RECIPIENT_KEY: Buffer.alloc(16, 1).toString("base64") })).toBeNull();
    expect(readRealSendEnv({ ...validEnv(), KAKAO_RECIPIENT_KEY: Buffer.alloc(33, 1).toString("base64") })).toBeNull();
    expect(readRealSendEnv({ ...validEnv(), KAKAO_RECIPIENT_KEY: "AAAA" })).toBeNull();
  });
  it("returns null when the recipient key is not base64", () => {
    expect(readRealSendEnv({ ...validEnv(), KAKAO_RECIPIENT_KEY: "!!!not-base64!!!" })).toBeNull();
  });
  it("accepts a base64url-encoded 32-byte recipient key", () => {
    expect(readRealSendEnv({ ...validEnv(), KAKAO_RECIPIENT_KEY: Buffer.alloc(32, 255).toString("base64url") })?.recipientKey).toEqual(Buffer.alloc(32, 255));
  });
});

describe("createRealSolapiTransport", () => {
  it("omits body from the actual call on GET with an empty body", async () => {
    const blocked = globalThis.fetch;
    const calls: { url: string; init: RequestInit }[] = [];
    const signal = new AbortController().signal;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return { status: 200, headers: { get: () => "application/json" }, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;
    try {
      const transport = createRealSolapiTransport();
      const response = await transport.fetch("https://api.solapi.com/messages/v4/list?messagesId=x", {
        method: "GET",
        headers: { Authorization: "HMAC-SHA256 test" },
        body: "",
        signal,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://api.solapi.com/messages/v4/list?messagesId=x");
      expect(calls[0].init.method).toBe("GET");
      expect(calls[0].init.headers).toEqual({ Authorization: "HMAC-SHA256 test" });
      expect(calls[0].init.signal).toBe(signal);
      expect(calls[0].init).not.toHaveProperty("body");
      expect(response.status).toBe(200);
      expect(response.headers?.get("content-type")).toBe("application/json");
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      globalThis.fetch = blocked;
    }
  });
  it("passes body, headers, and signal through on POST", async () => {
    const blocked = globalThis.fetch;
    const calls: { url: string; init: RequestInit }[] = [];
    const signal = new AbortController().signal;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return { status: 200, headers: { get: () => null }, json: async () => ({}) };
    }) as unknown as typeof fetch;
    try {
      const transport = createRealSolapiTransport();
      await transport.fetch("https://api.solapi.com/messages/v4/send-many/detail", {
        method: "POST",
        headers: { Authorization: "HMAC-SHA256 test", "Content-Type": "application/json" },
        body: '{"a":1}',
        signal,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].init.method).toBe("POST");
      expect(calls[0].init.body).toBe('{"a":1}');
      expect(calls[0].init.signal).toBe(signal);
    } finally {
      globalThis.fetch = blocked;
    }
  });
});

describe("buildRealLookupClient", () => {
  const ref = "M4V20240525163506DRKMPITQDY5Q6F";
  it("builds a lookup client that uses the injected transport", async () => {
    const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal } }[] = [];
    const transport: SolapiTransport = {
      async fetch(url, init) {
        calls.push({ url, init });
        return { status: 200, headers: { get: () => null }, json: async () => ({ messageList: { [ref]: { messageId: ref, statusCode: "4000" } } }) };
      },
    };
    const client = buildRealLookupClient(readRealSendEnv(validEnv())!, { transport });
    expect(client).toBeInstanceOf(SolapiLookupClient);
    expect(await client.lookupByMessageId(ref)).toEqual({ status: "delivered", ref });
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBe("");
  });
  it("fails closed through the default transport when the global fetch is blocked", async () => {
    const client = buildRealLookupClient(readRealSendEnv(validEnv())!);
    await expect(client.lookupByMessageId(ref)).resolves.toBeNull();
  });
});
