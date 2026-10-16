import { ServiceDenied } from "./contracts";
import type { ResponsesTransport } from "./provider";
/**
 * HTTP construction only. There is no default/global fetch binding, env lookup,
 * runtime factory or route wiring in this BUILD. Tests inject an in-memory fetch.
 */
export function openAiResponsesTransport(apiKey: string, fetcher: typeof fetch): ResponsesTransport {
    if (apiKey.length < 20 || apiKey.length > 256 || /[\r\n]/.test(apiKey))
        throw new ServiceDenied();
    return async (body, signal) => {
        if (signal.aborted)
            throw new ServiceDenied();
        try {
            const response = await fetcher("https://api.openai.com/v1/responses", { method: "POST", signal,
                headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error", cache: "no-store" });
            if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
                await response.body?.cancel().catch(() => undefined);
                throw new ServiceDenied();
            }
            const text = await response.text();
            if (signal.aborted || Buffer.byteLength(text) > 64000)
                throw new ServiceDenied();
            return JSON.parse(text) as unknown;
        }
        catch {
            throw new ServiceDenied();
        }
    };
}
