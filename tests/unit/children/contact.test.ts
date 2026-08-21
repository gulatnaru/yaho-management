import { describe, expect, it } from "vitest";
import { toTelHref } from "@/lib/children/contact";

describe("toTelHref", () => {
  it("normalizes a hyphen/space-separated phone number into a tel: href", () => {
    expect(toTelHref("010-1234-5678")).toBe("tel:01012345678");
  });

  it("keeps an already-normalized phone number as is", () => {
    expect(toTelHref("01012345678")).toBe("tel:01012345678");
  });

  it("preserves a leading + for international numbers", () => {
    expect(toTelHref("+82 10-1234-5678")).toBe("tel:+821012345678");
  });
});
