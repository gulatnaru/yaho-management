import { z } from "zod";

// Explicit fields, numeric/boolean values only. Never publish payloads, URLs,
// capabilities, child/guardian text, request headers or arbitrary annotations.
export const uxTraceSchema = z.object({
  event: z.enum(["deposit", "confirmation", "journey-db", "class-link-fixture", "class-price", "filter-clear", "guardian-review"]),
  elapsedMs: z.number().int().nonnegative(),
  facts: z.object({
    clickRequested: z.boolean().optional(), clicked: z.boolean().optional(), hydrated: z.boolean().optional(),
    diagnosticReadFailed: z.boolean().optional(), issuedGroups: z.number().int().nonnegative().optional(), activeLinks: z.number().int().nonnegative().optional(),
    requests: z.number().int().nonnegative().optional(), responses: z.number().int().nonnegative().optional(),
    finished: z.number().int().nonnegative().optional(), httpOk: z.boolean().optional(),
    requestOrdinal: z.number().int().nonnegative().optional(), responseOrdinal: z.number().int().nonnegative().optional(), finishedOrdinal: z.number().int().nonnegative().optional(), httpStatus: z.number().int().optional(),
    submissionTag: z.number().int().nonnegative().optional(), applicationTag: z.number().int().nonnegative().optional(), siblingTag: z.number().int().nonnegative().optional(),
    childTag: z.number().int().nonnegative().optional(), reservationTag: z.number().int().nonnegative().optional(), paymentTag: z.number().int().nonnegative().optional(), paymentItemTag: z.number().int().nonnegative().optional(), mappingTag: z.number().int().nonnegative().optional(),
    current: z.boolean().optional(), receiptVisible: z.boolean().optional(),
    applicationMatches: z.boolean().optional(), submissionMatches: z.boolean().optional(),
    newChild: z.boolean().optional(), childCreated: z.boolean().optional(), childMatches: z.boolean().optional(),
    reservation: z.boolean().optional(), payment: z.boolean().optional(), mapping: z.boolean().optional(),
    mappingMatches: z.boolean().optional(), siblingUnchanged: z.boolean().optional(),
    D: z.number().int().optional(), A: z.number().int().optional(), P: z.number().int().optional(), R: z.number().int().optional(), T: z.number().int().optional(),
    activePlaintextLinks: z.number().int().nonnegative().optional(), addressCount: z.number().int().nonnegative().optional(),
    priceBefore: z.number().int().nullable().optional(), requestedPrice: z.number().int().optional(), storedPrice: z.number().int().nullable().optional(), displayedPrice: z.boolean().optional(),
    hrefMatches: z.boolean().optional(), defaultPrevented: z.boolean().optional(), hitTarget: z.boolean().optional(),
    menuClosed: z.boolean().optional(), navigationRequests: z.number().int().nonnegative().optional(), finalUrlMatches: z.boolean().optional(),
    statusAll: z.boolean().optional(), notificationAll: z.boolean().optional(), bankRecordAll: z.boolean().optional(), pageReset: z.boolean().optional(),
    candidates: z.number().int().nonnegative().optional(), selectedCandidates: z.number().int().nonnegative().optional(),
    priceChangeVisible: z.boolean().optional(), totalVisible: z.boolean().optional(), inputsPreserved: z.boolean().optional(), consentsPreserved: z.boolean().optional(),
  }).strict(),
}).strict();
export type UxTrace = z.infer<typeof uxTraceSchema>;

export function safeUxTraces(annotations: readonly { type: string; description?: string }[]): UxTrace[] {
  return annotations.filter((item) => item.type === "ux-trace").slice(0, 50).flatMap((item) => {
    try { const result = uxTraceSchema.safeParse(JSON.parse(item.description ?? "")); return result.success ? [result.data] : []; }
    catch { return []; }
  });
}
