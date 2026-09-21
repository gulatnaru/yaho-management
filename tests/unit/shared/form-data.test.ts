import { describe, expect, it } from "vitest";
import { readFormString } from "@/lib/forms/form-data";

describe("readFormString", () => {
  it("returns string values without trimming or normalizing them", () => {
    const formData = new FormData();
    formData.set("value", "  original value  ");
    formData.set("empty", "");

    expect(readFormString(formData, "value")).toBe("  original value  ");
    expect(readFormString(formData, "empty")).toBe("");
  });

  it("returns undefined for missing and non-string values", () => {
    const formData = new FormData();
    formData.set("upload", new Blob(["file"]), "file.txt");

    expect(readFormString(formData, "missing")).toBeUndefined();
    expect(readFormString(formData, "upload")).toBeUndefined();
  });
});
