import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox, type CheckboxProps } from "@/components/ui/checkbox";

describe("Checkbox", () => {
  it("does not expose an input type prop in its TypeScript API", () => {
    const invalidProps: CheckboxProps = {
      // @ts-expect-error Checkbox owns its input type.
      type: "text",
    };

    expect(invalidProps).toEqual({ type: "text" });
  });

  it("keeps checkbox semantics even if a caller bypasses the prop type", () => {
    const bypassedProps = {
      defaultChecked: true,
      disabled: true,
      name: "consent",
      type: "text",
      value: "yes",
    } as unknown as CheckboxProps;
    const html = renderToStaticMarkup(createElement(Checkbox, bypassedProps));

    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('type="text"');
    expect(html).toContain('name="consent"');
    expect(html).toContain('value="yes"');
    expect(html).toContain("checked");
    expect(html).toContain("disabled");
  });
});
