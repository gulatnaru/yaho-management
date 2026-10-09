import { PREVIEW_E2E_TEST_FILES } from "./preview-runner";

export const GROUP_POSITIVE_TITLE = "A/B. ADMIN group controls reject a stale class and confirm two quoted siblings";
const FINANCE_POSITIVE_TITLE = "C/D. public guide and notification lead to selected confirmation and partial actual returns without a Refund";
const COMPANION_POSITIVE_TITLE = "E/F/G/H. owned device rotation, companion consent, and scoped purge stay capability-bound";
const groupFile = "tests/e2e/phase20-application-group-siblings.spec.ts";
const financeFile = "tests/e2e/phase20-application-finance-returns.spec.ts";
const companionFile = "tests/e2e/phase20-companion-repeat-privacy.spec.ts";
function titlePattern(title: string): string { return title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"; }

/** A fixed selection only; callers cannot supply paths, regexes or CLI switches. */
export function previewPlaywrightArguments(focus: string | undefined): string[] {
  if (focus === undefined) return ["test", ...PREVIEW_E2E_TEST_FILES];
  if (focus === "MINIMAL" || focus === "GROUP_POSITIVE_FULL") return ["test", groupFile, "--grep", titlePattern(GROUP_POSITIVE_TITLE)];
  if (focus === "FINANCE_POSITIVE") return ["test", financeFile, "--grep", titlePattern(FINANCE_POSITIVE_TITLE)];
  if (focus === "COMPANION_POSITIVE") return ["test", companionFile, "--grep", titlePattern(COMPANION_POSITIVE_TITLE)];
  if (focus === "THREE_POSITIVE") return ["test", groupFile, financeFile, companionFile, "--grep", [GROUP_POSITIVE_TITLE, FINANCE_POSITIVE_TITLE, COMPANION_POSITIVE_TITLE].map(titlePattern).join("|")];
  if (focus === "PHASE20") return ["test", groupFile, financeFile, companionFile, "tests/e2e/phase20-postgres-races.spec.ts"];
  throw new Error("P20_FOCUS_SELECTION_DENIED");
}
