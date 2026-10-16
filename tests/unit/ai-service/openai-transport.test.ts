import { describe, it, expect, vi } from "vitest";
import { openAiResponsesTransport } from "@/server/ai-service/openai-transport";
describe("OpenAI HTTP construction, in-memory fetch only", () => {
    it("uses fixed Responses URL/POST, caller cancellation and no redirects/retry", async () => {
        const fetcher = vi.fn(async () => Response.json({ usage: { input_tokens: 1, output_tokens: 1 }, output: [], status: "completed" }));
        const signal = new AbortController().signal;
        const transport = openAiResponsesTransport("synthetic-unit-api-key-not-live", fetcher);
        await transport({ store: false, model: "gpt-6-luna" }, signal);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect((fetcher.mock.calls as unknown[][])[0]).toMatchObject(["https://api.openai.com/v1/responses", { method: "POST", signal, redirect: "error", cache: "no-store" }]);
    });
    it("masks HTTP error body and never retries", async () => {
        const fetcher = vi.fn(async () => new Response("SYNTHETIC_PRIVATE_ERROR", { status: 429 }));
        await expect(openAiResponsesTransport("synthetic-unit-api-key-not-live", fetcher)({}, new AbortController().signal)).rejects.toThrow(/^AI_SERVICE_DENIED$/);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it("aborted request never invokes even injectedfetch", async () => {
        const fetcher = vi.fn(), controller = new AbortController();
        controller.abort();
        await expect(openAiResponsesTransport("synthetic-unit-api-key-not-live", fetcher)({}, controller.signal)).rejects.toThrow();
        expect(fetcher).not.toHaveBeenCalled();
    });
});
