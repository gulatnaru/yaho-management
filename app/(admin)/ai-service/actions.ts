"use server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { adminContext } from "@/server/ai-service/admin-context";
import { pauseService, saveConfig, saveGuidance, savePublication, findConsultationsBySubject, deleteConsultation } from "@/server/ai-service/admin";
import { reconcileMonth } from "@/server/ai-service/ledger";
import { countEligibleSkillDiag, purgeSkillDiagManual, retryRetention, type SkillDiagPurgeSuccess, type SkillDiagPurgeFailure } from "@/server/ai-service/retention";
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
export type PauseServiceState = { paused: true; version: number; alreadyPaused: boolean; pausedAt: string } | { formError: "AI_SERVICE_DENIED" } | null;
export async function pauseServiceAction(_previousState: PauseServiceState, form: FormData): Promise<PauseServiceState> {
    try {
    let result: Exclude<PauseServiceState, { formError: string } | null> | null = null;
    await action(async () => {
        // adminContext()는 첫 문장으로 assertDeploymentApproved()를 호출하므로, 잠금이 닫혀 있는 동안에는 P-1 액션도 실행되지 않는다.
        // 이것은 결함이 아니라 설계상 정합이다 — 잠금이 닫혀 있으면 Skill 라우트와 관리자 변이가 전부 503/거부 상태라 상담이 이미 열려 있지 않기 때문이다. P-1이 필요한 상황은 잠금이 열려 있는 상태뿐이다.
        const c = await adminContext();
        const { expectedVersion } = parse(z.object({ expectedVersion: z.coerce.number().int().nonnegative() }).strict(), { expectedVersion: form.get("expectedVersion") ?? undefined });
        const paused = await pauseService(c.db, c.environment, c.actor, { expectedVersion });
        result = { ...paused, pausedAt: paused.pausedAt.toISOString() };
    });
    return result;
    } catch {
        return { formError: "AI_SERVICE_DENIED" };
    }
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

export type SkillDiagPurgePreviewState = { expectedEligible: number; asOf: string } | SkillDiagPurgeFailure | { formError: "AI_SERVICE_DENIED" } | null;
export type SkillDiagPurgeExecuteState = SkillDiagPurgeSuccess | SkillDiagPurgeFailure | null;

export async function previewSkillDiagPurgeAction(_previousState: SkillDiagPurgePreviewState, _form: FormData): Promise<SkillDiagPurgePreviewState> {
    void _previousState;
    void _form;
    try {
        const c = await adminContext();
        const expectedEligible = await countEligibleSkillDiag(c.db, c.environment, new Date());
        return { expectedEligible, asOf: new Date().toISOString() };
    } catch {
        try {
            const c = await adminContext();
            const remainingEligible = await countEligibleSkillDiag(c.db, c.environment, new Date());
            return { formError: "AI_SERVICE_DENIED", partialDiagDeleted: 0, remainingEligible, auditWritten: false };
        } catch {
            return { formError: "AI_SERVICE_DENIED" };
        }
    }
}

export async function executeSkillDiagPurgeAction(_previousState: SkillDiagPurgeExecuteState, form: FormData): Promise<SkillDiagPurgeExecuteState> {
    let beforeEligible: number | undefined;
    let expectedEligible: number | undefined;
    try {
        const c = await adminContext();
        ({ expectedEligible } = parse(z.object({ expectedEligible: z.coerce.number().int().nonnegative() }).strict(), { expectedEligible: form.get("expectedEligible") ?? undefined }));
        const runUuid = randomUUID();
        beforeEligible = await countEligibleSkillDiag(c.db, c.environment, new Date());
        if (beforeEligible !== expectedEligible) return { formError: "AI_SERVICE_DENIED", partialDiagDeleted: 0, remainingEligible: beforeEligible, auditWritten: false };
        const result = await purgeSkillDiagManual(c.db, c.environment, c.actor, new Date(), runUuid);
        if (!("formError" in result)) revalidatePath("/ai-service");
        return result;
    } catch {
        return { formError: "AI_SERVICE_DENIED", partialDiagDeleted: 0, remainingEligible: beforeEligible ?? expectedEligible ?? 0, auditWritten: false };
    }
}
