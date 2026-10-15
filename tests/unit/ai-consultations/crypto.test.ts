import { describe, it, expect } from "vitest";
import {
  readKeys,
  seal,
  open,
  subjectHashes,
} from "@/lib/ai-consultations/crypto";
import { RETENTION_MS } from "@/lib/ai-consultations/contracts";
import { keys, environment } from "./fixtures";
const createdAt = new Date("2026-01-01T00:00:00Z");
const binding = {
  id: "synthetic-record",
  runId: "synthetic-run",
  createdAt,
  expiresAt: new Date(createdAt.getTime() + RETENTION_MS),
};
describe("AC21-09/15 encrypted record boundary", () => {
  it("stores no plaintext and reads only before expiry", () => {
    const sealed = seal(keys, binding, { question: "SYNTHETIC SECRET" });
    expect(sealed.rawCiphertext).not.toContain("SYNTHETIC SECRET");
    expect(open(keys, binding, sealed.rawCiphertext, () => createdAt)).toEqual({
      question: "SYNTHETIC SECRET",
    });
  });
  it.each([0, 1])("rejects at or beyond expiry %s", (delta) => {
    const sealed = seal(keys, binding, {});
    expect(() =>
      open(
        keys,
        binding,
        sealed.rawCiphertext,
        () => new Date(binding.expiresAt.getTime() + delta),
      ),
    ).toThrow("AI_REQUEST_DENIED");
  });
  it("rechecks expiry after decrypt", () => {
    let n = 0;
    const sealed = seal(keys, binding, {});
    expect(() =>
      open(keys, binding, sealed.rawCiphertext, () =>
        n++ ? binding.expiresAt : createdAt,
      ),
    ).toThrow();
  });
  it.each(["id", "runId", "createdAt", "expiresAt"])(
    "binds AAD %s",
    (field) => {
      const sealed = seal(keys, binding, {});
      const altered = {
        ...binding,
        [field]: field.endsWith("At")
          ? new Date(createdAt.getTime() + 1)
          : "other",
      };
      expect(() =>
        open(keys, altered, sealed.rawCiphertext, () => createdAt),
      ).toThrow("AI_REQUEST_DENIED");
    },
  );
  it("rejects tamper and missing encryption version without plaintext fallback", () => {
    const sealed = seal(keys, binding, {});
    expect(() =>
      open(
        { ...keys, encryption: {} },
        binding,
        sealed.rawCiphertext,
        () => createdAt,
      ),
    ).toThrow();
    const parts = JSON.parse(sealed.rawCiphertext);
    parts[3] = Buffer.from("tamper").toString("base64");
    expect(() =>
      open(keys, binding, JSON.stringify(parts), () => createdAt),
    ).toThrow();
  });
  it("reads previous key version during rotation and retains old HMAC alias", () => {
    const old = seal(keys, binding, {});
    const env = environment();
    env.AI_ENCRYPTION_KEYS = JSON.stringify({
      v1: Buffer.alloc(32, 1).toString("base64"),
      v2: Buffer.alloc(32, 4).toString("base64"),
    });
    env.AI_HMAC_KEYS = JSON.stringify({
      v1: Buffer.alloc(32, 2).toString("base64"),
      v2: Buffer.alloc(32, 5).toString("base64"),
    });
    env.AI_ENCRYPTION_ACTIVE = "v2";
    env.AI_HMAC_ACTIVE = "v2";
    const next = readKeys(env);
    expect(open(next, binding, old.rawCiphertext, () => createdAt)).toEqual({});
    expect(subjectHashes(next, "run", "subject")).toContain(
      subjectHashes(keys, "run", "subject")[0],
    );
  });
  it.each(["AI_ENCRYPTION_KEYS", "AI_HMAC_KEYS", "AI_MOCK_REQUEST_SECRET"])(
    "rejects missing %s",
    (field) => {
      const env = environment();
      delete env[field];
      expect(() => readKeys(env)).toThrow("AI_REQUEST_DENIED");
    },
  );
  it("refuses key reuse between auth, encryption and HMAC", () => {
    const env = environment();
    env.AI_MOCK_REQUEST_SECRET = Buffer.alloc(32, 1).toString("base64");
    expect(() => readKeys(env)).toThrow();
  });
});
