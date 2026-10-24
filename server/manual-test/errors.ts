export class ManualTestError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
export function requireManual(condition: unknown, code: string, status = 400): asserts condition {
  if (!condition) throw new ManualTestError(code, status);
}
