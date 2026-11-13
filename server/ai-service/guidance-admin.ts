import { createHash } from "node:crypto";
import { z } from "zod";
import { assertAdmin, parse, guidanceSchema, ServiceDenied, type Actor, type Environment } from "./contracts";
import { saveGuidanceInTransaction } from "./admin";
import { safePublicText } from "./public-text";
import { transaction, type Database } from "./repository";
import approvedRegistry from "./approved-guidance-v1.json";
export type ApprovedGuidanceEntry = {
    topic: string;
    version: number;
    filename: string;
    sha256: string;
    characters: number;
    bytes: number;
};
export type ApprovedGuidanceRegistry = {
    registryVersion: string;
    entries: Record<string, ApprovedGuidanceEntry>;
};
export const APPROVED_GUIDANCE_TOPICS = ["PREPARATION", "RAIN"] as const;
const submissionSchema = z.object({
    topic: z.string(),
    content: z.string(),
    expectedVersion: z.number().int().nonnegative(),
    // Accepted and ignored: the stored value is always approved=true (PLAN §1.5).
    // The approval proof is the content hash, not this flag.
    approved: z.boolean().optional(),
});
function sha256Hex(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
/**
 * Approved-guidance registration (OQ-16). Only the two operator-approved v1
 * texts may be stored, and only by an authenticated ADMIN in PREVIEW.
 * Validation order (SPEC §4.3): newline normalization (D-13) -> topic
 * allowlist -> PREVIEW-only -> ADMIN -> content sha256 against the approved
 * registry (normalized submitted bytes, before trim) -> guidanceSchema parse
 * + safePublicText (before entering the transaction, SPEC §4.3 item 9) ->
 * inner write + audit row in a single real transaction (D-12, option 2: no
 * nested $transaction — a Prisma TransactionClient has no $transaction method
 * at runtime). Any failure returns the fixed error only and stores nothing.
 * The form submission layer turns textarea newlines into CRLF, so the hash
 * is computed on the LF-normalized content (D-13); the stored content is
 * byte-identical to the approved LF original.
 */
export async function saveApprovedGuidance(db: Database, environment: Environment, actor: Actor, value: unknown, registry: ApprovedGuidanceRegistry = approvedRegistry) {
    const input = parse(submissionSchema, value);
    if (!(APPROVED_GUIDANCE_TOPICS as readonly string[]).includes(input.topic))
        throw new ServiceDenied();
    if (environment !== "PREVIEW")
        throw new ServiceDenied();
    assertAdmin(actor);
    const entry = registry.entries[input.topic];
    if (!entry)
        throw new ServiceDenied();
    // D-13 (SPEC §4.3 step 0): the form submission layer turns textarea
    // newlines into CRLF, so normalize newlines to LF before the hash
    // comparison. Every later step (hash, schema parse, safePublicText,
    // storage) uses this same normalized value, so the stored content stays
    // byte-identical to the approved LF original.
    const content = input.content.replace(/\r\n?/g, "\n");
    const digest = sha256Hex(content);
    if (digest !== entry.sha256)
        throw new ServiceDenied();
    const guidanceInput = parse(guidanceSchema, { topic: input.topic, content, approved: true, expectedVersion: input.expectedVersion });
    safePublicText(guidanceInput.content);
    return transaction(db, environment, async (tx) => {
        const saved = await saveGuidanceInTransaction(tx, environment, actor, guidanceInput);
        await tx.aiServiceGuidanceAudit.create({ data: { environment, topic: input.topic, version: saved.version, contentSha256: digest, actorId: actor.userId } });
        return saved;
    });
}
export type GuidanceRegistrationState = {
    topic: string;
    version: number;
    approved: boolean;
    contentSha256: string;
    updatedAt: Date;
};
/** Read-only registration state for the guidance page (topic, version, approval, content hash). */
export async function readApprovedGuidanceState(db: Database, environment: Environment, actor: Actor): Promise<GuidanceRegistrationState[]> {
    assertAdmin(actor);
    if (environment !== "PREVIEW")
        throw new ServiceDenied();
    return transaction(db, environment, async (tx) => {
        const rows = await tx.aiServiceKnowledgeEntry.findMany({ where: { environment, topic: { in: [...APPROVED_GUIDANCE_TOPICS] } }, orderBy: { topic: "asc" } });
        return rows.map((row) => ({ topic: row.topic, version: row.version, approved: row.approved, contentSha256: sha256Hex(row.content), updatedAt: row.updatedAt }));
    });
}
