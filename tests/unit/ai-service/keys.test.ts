import { randomBytes } from "node:crypto";
import { describe, it, expect } from "vitest";
import { readServiceKeys } from "@/server/ai-service/keys";
function env() { return { NODE_ENV: "test" as const, AI_SERVICE_ENCRYPTION_KEYS: JSON.stringify({ v1: randomBytes(32).toString("base64") }), AI_SERVICE_HMAC_KEYS: JSON.stringify({ v1: randomBytes(32).toString("base64") }), AI_SERVICE_ENCRYPTION_ACTIVE: "v1", AI_SERVICE_HMAC_ACTIVE: "v1" }; }
describe("isolated service key configuration", () => {
    it("reads separate versioned keyrings without Mock credentials", () => expect(readServiceKeys(env()).encryption.v1).toHaveLength(32));
    it("masks malformed env JSON and missingactiveversion", () => { expect(() => readServiceKeys({ ...env(), AI_SERVICE_ENCRYPTION_KEYS: "SYNTHETIC_INVALID" })).toThrow(/^AI_SERVICE_DENIED$/); expect(() => readServiceKeys({ ...env(), AI_SERVICE_HMAC_ACTIVE: "v2" })).toThrow(); });
    it("rejects key reuse across encryption/HMAC", () => { const e = env(); e.AI_SERVICE_HMAC_KEYS = e.AI_SERVICE_ENCRYPTION_KEYS; expect(() => readServiceKeys(e)).toThrow(); });
});
