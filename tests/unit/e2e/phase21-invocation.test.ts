import { describe, it, expect, vi } from "vitest";
import { readPreviewInvocationConfiguration } from "@/lib/e2e/preview-invocation";
import { type PreviewE2eConfiguration } from "@/lib/e2e/preview-runner";
import { environment } from "../ai-consultations/fixtures";
describe("fixed Preview invocation preflight", () => {
  it("invalid optional selection fails before further configuration/client preparation", () => {
    const read = vi.fn();
    expect(() =>
      readPreviewInvocationConfiguration(
        { ...environment(), PREVIEW_E2E_FOCUS: "PHASE21 --headed" },
        read,
      ),
    ).toThrow("P20_FOCUS_SELECTION_DENIED");
    expect(read).not.toHaveBeenCalled();
  });
  it("default run requires no AI keys/limits and optional run validates them before further preparation", () => {
    const env = environment();
    for (const key of Object.keys(env).filter((key) => key.startsWith("AI_")))
      delete env[key];
    const config = {} as PreviewE2eConfiguration;
    const read = vi.fn(() => config);
    expect(readPreviewInvocationConfiguration(env, read)).toBe(config);
    read.mockClear();
    expect(() =>
      readPreviewInvocationConfiguration(
        { ...env, PREVIEW_E2E_FOCUS: "PHASE21" },
        read,
      ),
    ).toThrow("AI_REQUEST_DENIED");
    expect(read).not.toHaveBeenCalled();
  });
  it("valid optional synthetic key/limit configuration proceeds to existing guards", () => {
    const config = {} as PreviewE2eConfiguration;
    const read = vi.fn(() => config);
    expect(
      readPreviewInvocationConfiguration(
        { ...environment(), PREVIEW_E2E_FOCUS: "PHASE21" },
        read,
      ),
    ).toBe(config);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
