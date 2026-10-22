import { describe, expect, it } from "vitest";
import { hasReactHandler, recordTag } from "../../e2e/support/integrated-ux-sync";
import { safeUxTraces } from "../../e2e/support/ux-trace";

describe("test-only React 19 hydration readiness", () => {
  it("requires the named hydrated host handler, not SSR attributes, native handlers or unrelated React internals", () => {
    const element = { onclick: () => {}, onChange: () => {}, "__reactFiber$abc": { onClick: () => {} }, "__reactProps$abc": { onChange: () => {} } } as unknown as Element;
    expect(hasReactHandler(element, "onClick")).toBe(false);
    expect(hasReactHandler(element, "onChange")).toBe(true);
    expect(hasReactHandler({ "__reactProps$abc": { onClick: "not-a-function" } } as unknown as Element, "onClick")).toBe(false);
    expect(hasReactHandler({ "__reactProps$abc": { onClick: () => {} } } as unknown as Element, "onClick")).toBe(true);
  });
  it("correlates run-owned record IDs using stable numeric tags without publishing the IDs", () => {
    expect(recordTag("run-application-1")).toBe(recordTag("run-application-1"));
    expect(recordTag("run-application-1")).not.toBe(recordTag("run-application-2"));
    expect(Number.isSafeInteger(recordTag("run-application-1"))).toBe(true);
    expect(recordTag(null)).toBeUndefined();
  });
});

describe("bounded safe UX trace projection", () => {
  it("retains ordered numeric/boolean facts only and drops arbitrary payloads, annotations and malformed traces", () => {
    const annotation = (value: unknown) => ({ type: "ux-trace", description: JSON.stringify(value) });
    const safe = { event: "confirmation", elapsedMs: 1, facts: { requests: 2, current: true, applicationTag: recordTag("run-application-1") } };
    expect(safeUxTraces([
      annotation(safe),
      annotation({ ...safe, facts: { guardianName: "PII_CANARY" } }),
      annotation({ ...safe, facts: { requests: "TOKEN_CANARY" } }),
      annotation({ ...safe, capability: "SECRET_CANARY" }),
      annotation({ ...safe, event: "ARBITRARY_CANARY" }),
      { type: "ux-trace", description: "MALFORMED_CANARY" },
      { type: "other", description: JSON.stringify(safe) },
    ])).toEqual([safe]);
    expect(safeUxTraces(Array.from({ length: 100 }, () => annotation(safe)))).toHaveLength(50);
  });
});
