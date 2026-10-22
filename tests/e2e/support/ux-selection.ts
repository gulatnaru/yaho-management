import { z } from "zod";

// Read-only inventory must precede mutation suites, even in focused runs.
export const uxSpecOrder = ["family-list", "class-links", "family-detail", "ledger", "confirmation", "completion", "guardian", "full-journey"] as const;
export const uxSpecBasenames = uxSpecOrder.map((spec) => `integrated-ux-${spec}`);
export const uxSelectionSchema = z.object({
  selectedSpecs: z.array(z.string().refine((name) => uxSpecBasenames.includes(name))).min(1),
  focused: z.boolean(),
}).strict();
export type UxSelection = z.infer<typeof uxSelectionSchema>;

export function selectUxSpecs(value?: string): UxSelection {
  if (!value?.trim()) return { selectedSpecs: [...uxSpecBasenames], focused: false };
  const requested = value.split(",").map((name) => name.trim());
  if (!uxSelectionSchema.shape.selectedSpecs.safeParse(requested).success) throw new Error("UX_SPECS_UNKNOWN_NAME");
  const selectedSpecs = uxSpecBasenames.filter((name) => requested.includes(name));
  return { selectedSpecs, focused: selectedSpecs.length !== uxSpecOrder.length };
}
