import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  APPLICATION_COMPLETE_PATH,
  openApplicationCompletePage,
  preventResubmitAfterSuccess,
} from "@/lib/reservation-applications/complete-navigation";

function read(relative: string) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

type TestState = { submitted?: boolean; formError?: string };

describe("openApplicationCompletePage", () => {
  it("replaces the whole document with the completion page", () => {
    const location = { replace: vi.fn(), assign: vi.fn() };

    openApplicationCompletePage(location);

    expect(APPLICATION_COMPLETE_PATH).toBe("/apply/complete");
    expect(location.replace).toHaveBeenCalledTimes(1);
    expect(location.replace).toHaveBeenCalledWith("/apply/complete");
    expect(location.assign).not.toHaveBeenCalled();
  });
});

describe("preventResubmitAfterSuccess", () => {
  it("passes submissions through until one succeeds", async () => {
    const action = vi.fn<(state: TestState, payload: string) => Promise<TestState>>(async () => ({ formError: "다시 시도해 주세요." }));
    const guarded = preventResubmitAfterSuccess(action);

    await expect(guarded({}, "payload")).resolves.toEqual({ formError: "다시 시도해 주세요." });
    await expect(guarded({ formError: "이전 오류" }, "payload")).resolves.toEqual({ formError: "다시 시도해 주세요." });
    expect(action).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenLastCalledWith({ formError: "이전 오류" }, "payload");
  });

  it("never calls the server again after a successful submission", async () => {
    const action = vi.fn<(state: TestState, payload: string) => Promise<TestState>>(async () => ({ submitted: true }));
    const guarded = preventResubmitAfterSuccess(action);

    const first = await guarded({}, "first");
    const second = await guarded(first, "second");
    const third = await guarded(second, "third");

    expect(first).toEqual({ submitted: true });
    expect(third).toBe(first);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith({}, "first");
  });
});

describe("public application form wiring", () => {
  const form = read("../../../app/(public)/apply/[token]/_components/reservation-application-form.tsx");
  const actions = read("../../../app/(public)/apply/[token]/actions.ts");

  it("opens the completion page with a full document navigation, never a client transition", () => {
    expect(form).toMatch(/useEffect\(\(\) => \{\s*if \(submitted\) openApplicationCompletePage\(\);\s*\}, \[submitted\]\);/);
    expect(form).not.toContain("next/navigation");
    expect(form).not.toContain("useRouter");
    expect(form).not.toMatch(/router\.(push|replace)/);
    expect(form).not.toContain("next/link");
  });

  it("guards the action and disables the submit button after success", () => {
    expect(form).toContain("useActionState(guardedAction, initialState)");
    expect(form).toContain("preventResubmitAfterSuccess(action)");
    expect(form).toContain("disabled={pending || submitted}");
  });

  it("does not redirect from the Server Action on success", () => {
    expect(actions).not.toContain("next/navigation");
    expect(actions).not.toMatch(/^\s*(return\s+)?redirect\(/m);
    expect(actions).toContain("return { submitted: true };");
  });
});
