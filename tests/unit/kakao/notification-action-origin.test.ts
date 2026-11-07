import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

// Exercise Next's actual Server Action request handler with an in-memory POST.
// This is a framework-level check; it does not exercise routing or a deployed proxy.
const require = createRequire(import.meta.url);
const { handleAction } = require("next/dist/server/app-render/action-handler") as {
  handleAction: (input: Record<string, unknown>) => Promise<unknown>;
};

it("rejects a cross-origin multipart Server Action POST before invoking the action", async () => {
  const request = new Request("https://admin.example.test/reservation-applications/notifications", {
    method: "POST",
    headers: { origin: "https://attacker.example.test", host: "admin.example.test" },
    body: new FormData(),
  });
  const headers = Object.fromEntries(request.headers.entries());
  const invoke = vi.fn();
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(handleAction({
      req: { method: request.method, headers },
      res: {}, ComponentMod: { actionAsyncStorage: { run: invoke } }, serverModuleMap: {},
      generateFlight: vi.fn(), workStore: { isStaticGeneration: false }, requestStore: {},
      serverActions: {}, ctx: { renderOpts: { serverActionsManifest: { node: { synthetic: {} }, edge: {} }, page: "/reservation-applications/notifications" } }, metadata: {},
    })).rejects.toThrow("Invalid Server Actions request.");
    expect(invoke).not.toHaveBeenCalled();
  } finally {
    errorLog.mockRestore();
  }
});
