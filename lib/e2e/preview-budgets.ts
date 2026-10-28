/** Cleanup includes connection acquisition; browser/intake limits remain unchanged. */
export const PHASE21_PREVIEW_CLEANUP_OPTIONS = {
  maxWait: 1000,
  timeout: 15000,
} as const;
export const PREVIEW_E2E_STARTUP_ALLOWANCE_MS = 60_000;
