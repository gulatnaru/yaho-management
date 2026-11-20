import { createHash } from "node:crypto";
import { z } from "zod";
import { assertAdmin, parse, guidanceSchema, ServiceDenied, type Actor, type Environment } from "./contracts";
import { saveGuidanceInTransaction } from "./admin";
import { safeApprovedGuidanceText } from "./approved-guidance-text";
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
export const APPROVED_GUIDANCE_TOPICS = ["PREPARATION", "RAIN", "POLICY"] as const;
const submissionSchema = z.object({
    topic: z.string(),
    content: z.string(),
    expectedVersion: z.number().int().nonnegative(),
    approved: z.boolean().optional(),
});
function sha256Hex(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
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
    const content = input.content.replace(/\r\n?/g, "\n");
    const digest = sha256Hex(content);
    if (digest !== entry.sha256)
        throw new ServiceDenied();
    safeApprovedGuidanceText(content, input.topic);
    const guidanceInput = parse(guidanceSchema, { topic: input.topic, content, approved: true, expectedVersion: input.expectedVersion });
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
export async function readApprovedGuidanceState(db: Database, environment: Environment, actor: Actor): Promise<GuidanceRegistrationState[]> {
    assertAdmin(actor);
    if (environment !== "PREVIEW")
        throw new ServiceDenied();
    return transaction(db, environment, async (tx) => {
        const rows = await tx.aiServiceKnowledgeEntry.findMany({ where: { environment, topic: { in: [...APPROVED_GUIDANCE_TOPICS] } }, orderBy: { topic: "asc" } });
        return rows.map((row) => ({ topic: row.topic, version: row.version, approved: row.approved, contentSha256: sha256Hex(row.content), updatedAt: row.updatedAt }));
    });
}
