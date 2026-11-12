import { createHash } from "node:crypto";
import { z } from "zod";
import { assertAdmin, parse, ServiceDenied, type Actor, type Environment } from "./contracts";
import { saveGuidance } from "./admin";
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
 * Validation order (PLAN §4.3): topic allowlist -> PREVIEW-only -> ADMIN ->
 * content sha256 against the approved registry (raw submitted bytes, before
 * trim) -> existing saveGuidance (schema, safePublicText, optimistic version)
 * -> audit row in the same transaction. Any failure returns the fixed error
 * only and stores nothing.
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
    const digest = sha256Hex(input.content);
    if (digest !== entry.sha256)
        throw new ServiceDenied();
    return transaction(db, environment, async (tx) => {
        // Option 1 (PLAN §1.6): reuse saveGuidance inside the outer
        // transaction. A Prisma TransactionClient supports the callback form
        // of $transaction (savepoints), and repository.transaction() only uses
        // that form, so the cast is sound at runtime; the integration test
        // proves the nesting against real PostgreSQL.
        const saved = await saveGuidance(tx as unknown as Database, environment, actor, { topic: input.topic, content: input.content, approved: true, expectedVersion: input.expectedVersion });
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
