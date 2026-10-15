/** Always attempt every cleanup phase; release ownership only after all succeed. */
export async function cleanupPreviewRunPhases<T>(input: {
  phase21: () => Promise<unknown>;
  phase20: () => Promise<unknown>;
  legacy: () => Promise<T>;
  releaseLease: () => Promise<unknown>;
}): Promise<T> {
  let failed = false;
  let legacyResult: T | undefined;
  try {
    await input.phase21();
  } catch {
    failed = true;
  }
  try {
    await input.phase20();
  } catch {
    failed = true;
  }
  try {
    legacyResult = await input.legacy();
  } catch {
    failed = true;
  }
  if (failed) throw new Error("PREVIEW_CLEANUP_PHASE_FAILED");
  await input.releaseLease();
  return legacyResult as T;
}
