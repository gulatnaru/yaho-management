import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleSkill, type Dependencies } from "@/server/ai-service/handler";
import { fakeDb, now, seedConfig } from "./fake-db";

describe("authentication secret persistence boundary", () => {
    it("keeps secret, header and their hashes out of stored rows, logs and replies", async () => {
        const f = fakeDb();
        seedConfig(f);
        const prod = "synthetic-prod-sentinel-0123456789abcdef";
        const test = "synthetic-test-sentinel-0123456789abcdef";
        const wrong = "synthetic-wrong-sentinel-0123456789abcdef";
        const dependencies: Dependencies = { db: f.db, environment: "PREVIEW", secret: prod, testSecret: test, botId: "synthetic-bot", clock: () => now,
            keys: { encryption: { v1: Buffer.alloc(32, 1) }, hmac: { v1: Buffer.alloc(32, 2) }, activeEncryption: "v1", activeHmac: "v1" },
            tools: { execute: vi.fn(async call => call.name === "list_public_programs" ? { kind: "PROGRAMS" as const, items: [] } : call.name === "list_public_classes" ? { kind: "CLASSES" as const, items: [] } : { kind: "GUIDANCE" as const, content: "합성 안내" }) } };
        const raw = JSON.stringify({ bot: { id: "synthetic-bot" }, userRequest: { utterance: "야호 준비물을 알려 주세요", user: { id: "synthetic-subject" } }, action: { id: "synthetic-action", name: "synthetic" } });
        const logs: unknown[] = [];
        const spies = ["log", "warn", "error", "info"].map(name => vi.spyOn(console, name as "log" | "warn" | "error" | "info").mockImplementation((...args: unknown[]) => { logs.push(args); }));
        try {
            const success = await handleSkill(new Headers({ "x-yaho-skill-key": test }), raw, "synthetic-sentinel-request", dependencies);
            const failure = await handleSkill(new Headers({ "x-yaho-skill-key": wrong }), raw, "synthetic-sentinel-failure", dependencies);
            expect(f.state.aiServiceRequest).toHaveLength(1);
            expect(f.state.aiServiceRequest[0]).toMatchObject({ authKind: "test" });
            const serialized = JSON.stringify({ requests: f.state.aiServiceRequest, audits: f.state.aiServiceDeletionAudit, logs, success, failure });
            for (const secret of [prod, test, wrong]) {
                for (const sentinel of [secret, createHash("sha256").update(secret).digest("hex"), createHash("sha256").update(secret).digest("base64")]) {
                    // Only a boolean is reported on failure; the sentinel itself never appears in test output.
                    expect(serialized.includes(sentinel)).toBe(false);
                }
            }
        } finally {
            for (const spy of spies) spy.mockRestore();
        }
    });
});
