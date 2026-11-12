"use server";
import { revalidatePath } from "next/cache";
import { guidanceAdminContext } from "@/server/ai-service/guidance-context";
import { saveApprovedGuidance } from "@/server/ai-service/guidance-admin";
import approvedRegistry from "@/server/ai-service/approved-guidance-v1.json";
import { ServiceDenied } from "@/server/ai-service/contracts";
function values(form: FormData) { return Object.fromEntries(form.entries()); }
export async function saveApprovedGuidanceAction(form: FormData) {
    try {
        const c = await guidanceAdminContext(), v = values(form);
        await saveApprovedGuidance(c.db, c.environment, c.actor, { topic: v.topic, content: v.content, expectedVersion: Number(v.expectedVersion) }, approvedRegistry);
    }
    catch {
        throw new ServiceDenied();
    }
    revalidatePath("/ai-service/guidance");
}
