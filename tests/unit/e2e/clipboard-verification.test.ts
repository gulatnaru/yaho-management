import { describe, expect, it } from "vitest";
import { assertClipboardVerification, clipboardVerificationRecords } from "@/lib/e2e/clipboard-verification";

function attempts() {
  return [1, 2, 3].map((ordinal) => ({ ordinal, readyStateAtClick: "complete", focusAtClick: true, clickSeen: true, called: 1, resolved: 1, rejected: 0, callMs: 0, settleMs: 13, focusAtCall: true, focusAtSettle: true, statusBefore: ordinal !== 1, successSeen: ordinal === 1, errorSeen: false, statusMs: ordinal === 1 ? 15 : null, pending: false, readyStateAtRead: "complete", focusAtRead: true }));
}

describe("native clipboard verification", () => {
  it("requires a fresh first status and three distinct settled native calls", () => {
    expect(() => assertClipboardVerification(clipboardVerificationRecords(attempts()))).not.toThrow();
  });
  it("omits arbitrary secret fields from serialized browser state", () => {
    const input = attempts().map((item) => ({ ...item, privateClipboard: "MUST_NOT_BE_SERIALIZED", body: { token: "MUST_NOT_BE_SERIALIZED" } }));
    const serialized = JSON.stringify(clipboardVerificationRecords(input));
    expect(serialized).not.toContain("MUST_NOT_BE_SERIALIZED");
    expect(serialized).not.toContain("privateClipboard");
    expect(serialized).not.toContain("token");
  });
  it.each([
    { statusBefore: true }, { successSeen: false }, { called: 0 }, { resolved: 0 },
    { pending: true }, { rejected: 1 }, { errorSeen: true }, { settleMs: null }, { called: 2 },
  ])("rejects stale, missing, pending, rejected or duplicate calls %j", (change) => {
    const input = attempts(); Object.assign(input[0]!, change);
    expect(() => assertClipboardVerification(clipboardVerificationRecords(input))).toThrow(/^P20_CLIPBOARD_/);
  });
  it("rejects a stale later status without a new native settlement", () => {
    const input = attempts(); input[1]!.resolved = 0;
    expect(() => assertClipboardVerification(clipboardVerificationRecords(input))).toThrow("P20_CLIPBOARD_NATIVE_UNPROVEN");
  });
  it("rejects missing, duplicate and additional ordinals", () => {
    const input = attempts(); input[2]!.ordinal = 2;
    expect(() => assertClipboardVerification(clipboardVerificationRecords(input))).toThrow("P20_CLIPBOARD_NATIVE_UNPROVEN");
    expect(() => assertClipboardVerification(clipboardVerificationRecords(attempts().slice(0, 2)))).toThrow("P20_CLIPBOARD_NATIVE_UNPROVEN");
    expect(() => clipboardVerificationRecords([...attempts(), attempts()[0]])).toThrow("P20_CLIPBOARD_STATE_INVALID");
  });
  it.each([
    { input: null }, { input: {} }, { input: [{ ordinal: 1 }] },
    { input: attempts().map((item) => ({ ...item, callMs: 15001 })) },
    { input: attempts().map((item) => ({ ...item, readyStateAtClick: "private-value" })) },
  ])("rejects malformed or unbounded state", ({ input }) => {
    expect(() => clipboardVerificationRecords(input)).toThrow("P20_CLIPBOARD_STATE_INVALID");
  });
});
