import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const selection = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => actual.useState(Array.isArray(initial) ? selection.ids : initial) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(admin)/reservation-applications/actions", () => ({ issueClassApplicationLink: vi.fn() }));
const { MultiClassLinkComposer } = await import("@/app/(admin)/classes/_components/multi-class-link-composer");
const options = Array.from({ length: 101 }, (_, index) => ({ id: `class-${index}`, label: `class-${index}`, applicationPrice: 20000, eligible: true, revision: "a".repeat(64) }));
beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());
function checkboxes() {
  return renderToStaticMarkup(React.createElement(MultiClassLinkComposer, { options, currentClassId: "class-0" })).match(/<input[^>]*>/g)!;
}

it("blocks additional selection at the server's 100-class bound while preserving deselection", () => {
  selection.ids = options.slice(0, 100).map((row) => row.id);
  const inputs = checkboxes();
  expect(inputs[0]).toContain("disabled"); // The current class stays selected.
  expect(inputs[99]).toContain("checked"); expect(inputs[99]).not.toContain("disabled");
  expect(inputs[100]).toContain("disabled"); expect(inputs[100]).not.toContain("checked");
});

it("allows additional selection again below the server's class bound", () => {
  selection.ids = options.slice(0, 99).map((row) => row.id);
  expect(checkboxes()[100]).not.toContain("disabled");
});
