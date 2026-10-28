import { describe, it, expect, vi } from "vitest";
import { skillSchema } from "@/lib/ai-consultations/contracts";
import {
  assertMockEnvironment,
  verifyProof,
  authorizeScope,
  readBoundedBody,
} from "@/server/ai-consultations/runtime";
import { mockSkillHandler } from "@/server/ai-consultations/handler";
import { environment, skill, proof, scope, memoryClient } from "./fixtures";
describe("AC21-01/13/14 Mock isolation", () => {
  it.each(["production", "development", "test", undefined])(
    "blocks environment %s before body/client/provider",
    async (value) => {
      const env = environment();
      env.VERCEL_ENV = value;
      const client = vi.fn();
      const provider = { plan: vi.fn() };
      const request = {
        get body() {
          throw new Error("BODY_READ");
        },
      } as unknown as Request;
      const response = await mockSkillHandler({
        environment: env,
        client,
        provider,
      })(request);
      expect(response.status).toBe(403);
      expect(client).not.toHaveBeenCalled();
      expect(provider.plan).not.toHaveBeenCalled();
    },
  );
  it("rejects a Production database even under a Preview environment", () => {
    const env = environment();
    env.DIRECT_URL = env.DIRECT_URL?.replace(
      "previewproject",
      "productionproject",
    );
    expect(() => assertMockEnvironment(env)).toThrow();
  });
  it("refuses unknown refs, missing SHA and synthetic=true", () => {
    for (const field of [
      "VERCEL_GIT_COMMIT_SHA",
      "PRODUCTION_E2E_SUPABASE_PROJECT_REF",
      "PREVIEW_E2E_SUPABASE_PROJECT_REF",
    ]) {
      const env = environment();
      delete env[field];
      expect(() => assertMockEnvironment(env)).toThrow();
    }
    expect(skillSchema.safeParse({ ...skill(), synthetic: true }).success).toBe(
      false,
    );
  });
  it("accepts only purpose/body/SHA/time-bound signatures", () => {
    const body = JSON.stringify(skill());
    const value = proof(body);
    expect(
      verifyProof(
        value,
        body,
        "POST:/api/ai-consultations/mock-skill",
        environment(),
        new Date(),
      ).runId,
    ).toBe(scope.runId);
    for (const [b, p] of [
      [body + " ", "POST:/api/ai-consultations/mock-skill"],
      [body, "AI_ADMIN"],
    ])
      expect(() =>
        verifyProof(value, b, p, environment(), new Date()),
      ).toThrow();
    expect(() =>
      verifyProof(
        value,
        body,
        "POST:/api/ai-consultations/mock-skill",
        environment(),
        new Date(Date.now() + 61000),
      ),
    ).toThrow();
  });
  it("requires runtime identity, active lease and matching manifest", async () => {
    const db = memoryClient();
    const body = JSON.stringify(skill());
    const parsed = verifyProof(
      proof(body),
      body,
      "POST:/api/ai-consultations/mock-skill",
      environment(),
      new Date(),
    );
    expect(
      await authorizeScope(db.client, parsed, environment(), new Date()),
    ).toEqual(scope);
    db.revoke();
    await expect(
      authorizeScope(db.client, parsed, environment(), new Date()),
    ).rejects.toThrow();
    const bad = environment();
    bad.PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256 = "0".repeat(64);
    await expect(
      authorizeScope(memoryClient().client, parsed, bad, new Date()),
    ).rejects.toThrow();
  });
  it("does not accept arbitrary real utterance or Callback payload", () => {
    const input = skill();
    input.userRequest.utterance = "real customer question";
    expect(skillSchema.safeParse(input).success).toBe(false);
    expect(
      skillSchema.safeParse({
        ...skill(),
        callbackUrl: "https://example.invalid",
      }).success,
    ).toBe(false);
  });
  it("refuses oversize bodies and aborted streams", async () => {
    await expect(
      readBoundedBody(
        new Request("https://example.invalid", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "x".repeat(16385),
        }),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    const abort = new AbortController();
    abort.abort();
    await expect(
      readBoundedBody(
        new Request("https://example.invalid", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        abort.signal,
      ),
    ).rejects.toThrow();
  });
  it("does not instantiate DB on invalid body or signature", async () => {
    const client = vi.fn();
    for (const body of ["{}", JSON.stringify(skill())]) {
      const result = await mockSkillHandler({
        environment: environment(),
        client,
      })(
        new Request("https://example.invalid/api/ai-consultations/mock-skill", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      );
      expect(result.status).toBe(403);
    }
    expect(client).not.toHaveBeenCalled();
  });
});
