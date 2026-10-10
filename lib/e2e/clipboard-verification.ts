/** Fixed fields only: never serialize browser objects or clipboard contents. */
export function clipboardVerificationRecords(value: unknown) {
  if (!Array.isArray(value) || value.length > 3) throw new Error("P20_CLIPBOARD_STATE_INVALID");
  return value.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) throw new Error("P20_CLIPBOARD_STATE_INVALID");
    const item = entry as Record<string, unknown>;
    const bool = (key: string) => { if (typeof item[key] !== "boolean") throw new Error("P20_CLIPBOARD_STATE_INVALID"); return item[key] as boolean; };
    const number = (key: string, max: number, nullable = false): number | null => {
      const field = item[key];
      if (nullable && field === null) return null;
      if (typeof field !== "number" || !Number.isInteger(field) || field < 0 || field > max) throw new Error("P20_CLIPBOARD_STATE_INVALID");
      return field;
    };
    const ready = (key: string) => { const field = item[key]; if (field !== "loading" && field !== "interactive" && field !== "complete") throw new Error("P20_CLIPBOARD_STATE_INVALID"); return field; };
    return {
      source: "tests/e2e/phase20-application-finance-returns.spec.ts", category: "CLIPBOARD_VERIFICATION",
      ordinal: number("ordinal", 3), readyStateAtClick: ready("readyStateAtClick"), focusAtClick: bool("focusAtClick"),
      clickSeen: bool("clickSeen"), called: number("called", 3), resolved: number("resolved", 3), rejected: number("rejected", 3),
      callMs: number("callMs", 15_000, true), settleMs: number("settleMs", 15_000, true),
      focusAtCall: bool("focusAtCall"), focusAtSettle: bool("focusAtSettle"), statusBefore: bool("statusBefore"),
      successSeen: bool("successSeen"), errorSeen: bool("errorSeen"), statusMs: number("statusMs", 15_000, true),
      pending: bool("pending"), readyStateAtRead: ready("readyStateAtRead"), focusAtRead: bool("focusAtRead"),
    };
  });
}

export function assertClipboardVerification(records: ReturnType<typeof clipboardVerificationRecords>): void {
  if (records.length !== 3 || records.some((item, index) => item.ordinal !== index + 1 || !item.clickSeen || item.called !== 1 || item.resolved !== 1 || item.rejected !== 0 || item.pending || item.errorSeen || item.callMs === null || item.settleMs === null)) throw new Error("P20_CLIPBOARD_NATIVE_UNPROVEN");
  const first = records[0]!;
  if (first.statusBefore || !first.successSeen || first.statusMs === null) throw new Error("P20_CLIPBOARD_FRESH_STATUS_UNPROVEN");
}
