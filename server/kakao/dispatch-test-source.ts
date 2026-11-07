import "server-only";
import type { SyntheticDependencies } from "./dispatcher";

// Replaced only by the server-side test module loader. No runtime fixture exists.
export function getSyntheticTestDependencies(): SyntheticDependencies | null {
  return null;
}
