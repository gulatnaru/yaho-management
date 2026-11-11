"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { adminContext } from "@/server/ai-service/admin-context";
import { saveConfig, saveGuidance, savePublication, findConsultationsBySubject, deleteConsultation } from "@/server/ai-service/admin";
import { reconcileMonth } from "@/server/ai-service/ledger";
import { retryRetention } from "@/server/ai-service/retention";
import { parse, ServiceDenied } from "@/server/ai-service/contracts";
function values(form: FormData) { return Object.fromEntries(form.entries()); }
async function action(fn: () => Promise<unknown>) {
    try {
        await fn();
    }
    catch {
        throw new ServiceDenied();
    }
    revalidatePath("/ai-service");
}
export async function saveConfigAction(form: FormData) {
    await action(async () => {
        const c = await adminContext(), v = values(form);
        await saveConfig(c.db, c.environment, c.actor, { provider: v.provider, model: v.model, priceVersion: v.priceVersion, fxCheckedAt: v.fxCheckedAt, fxSource: v.fxSource, expectedVersion: Number(v.expectedVersion), paused: parse(z.enum(["true", "false"]), v.paused) === "true",
            schedulerEnabled: parse(z.enum(["true", "false"]), v.schedulerEnabled) === "true",
            inputNanoUsdPerToken: Number(v.inputNanoUsdPerToken), outputNanoUsdPerToken: Number(v.outputNanoUsdPerToken),
            fxMilliKrwPerUsd: Number(v.fxMilliKrwPerUsd) }, new Date());
    });
}
export async function savePublicationAction(form: FormData) {
    await action(async () => {
        const c = await adminContext(), v = values(form);
        await savePublication(c.db, c.environment, c.actor, { kind: v.kind, id: v.id, expectedVersion: Number(v.expectedVersion), enabled: v.enabled === "true" });
    });
}
export async function saveGuidanceAction(form: FormData) {
    await action(async () => {
        const c = await adminContext(), v = values(form);
        await saveGuidance(c.db, c.environment, c.actor, { topic: v.topic, content: v.content, expectedVersion: Number(v.expectedVersion), approved: v.approved === "true" });
    });
}
export async function reconcileAction(form: FormData) {
    await action(async () => {
        const c = await adminContext(), v = values(form);
        const data = parse(z.object({ month: z.string(), expectedVersion: z.coerce.number().int().nonnegative(),
            billedKrw: z.coerce.number().int().nonnegative(), heldActualKrw: z.coerce.number().int().nonnegative(),
            coveredThroughGeneration: z.coerce.number().int().nonnegative(), coverageConfirmed: z.literal("true"), reference: z.string(), resolveAllHeld: z.enum(["true", "false"]) }).strict(), { month: v.month, expectedVersion: v.expectedVersion, billedKrw: v.billedKrw, heldActualKrw: v.heldActualKrw, coveredThroughGeneration: v.coveredThroughGeneration, coverageConfirmed: v.coverageConfirmed, reference: v.reference, resolveAllHeld: v.resolveAllHeld });
        await reconcileMonth(c.db, c.environment, c.actor, { ...data, coverageConfirmed: true, resolveAllHeld: data.resolveAllHeld === "true" }, new Date());
    });
}
export async function retryRetentionAction() { await action(async () => { const c = await adminContext(); await retryRetention(c.db, c.environment, c.actor, new Date()); }); }

export type ConsultationLookupState = {
    rows?: { id: string; status: string; createdAt: string; expiresAt: string; category: string | null }[];
    deleted?: { deletedCount: number; remainingCount: number };
    formError?: string;
};

/**
 * Individual-delete lookup + delete actions (OQ-12 P0-B). These return a
 * state object instead of the void action() wrapper above: the lookup must
 * return rows to the client component, and a thrown error cannot carry them.
 * The security properties are the same — failures return only the fixed
 * "AI_SERVICE_DENIED" string, and the subject ID is never logged, stored,
 * or put in a cookie (it travels only as a form field the ADMIN resubmits).
 */
export async function lookupConsultationsBySubjectAction(_previousState: ConsultationLookupState, form: FormData): Promise<ConsultationLookupState> {
    try {
        const c = await adminContext(), v = values(form);
        const subjectUserId = parse(z.string().min(1).max(128), v.subjectUserId);
        const rows = await findConsultationsBySubject(c.db, c.environment, c.actor, c.keys, subjectUserId);
        return { rows: rows.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(), category: r.category ?? null })) };
    } catch {
        return { formError: "AI_SERVICE_DENIED" };
    }
}
export async function deleteConsultationAction(_previousState: ConsultationLookupState, form: FormData): Promise<ConsultationLookupState> {
    try {
        const c = await adminContext(), v = values(form);
        const deleted = await deleteConsultation(c.db, c.environment, c.actor, c.keys, {
            subjectUserId: v.subjectUserId, scope: v.scope, requestId: v.requestId ? String(v.requestId) : undefined, reasonCode: v.reasonCode,
        });
        revalidatePath("/ai-service");
        return { deleted };
    } catch {
        return { formError: "AI_SERVICE_DENIED" };
    }
}
