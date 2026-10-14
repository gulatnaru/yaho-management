"use server";
import { revalidatePath } from "next/cache";
import { adminContext } from "@/server/ai-consultations/admin-context";
import {
  updateGuidance,
  updatePublication,
} from "@/server/ai-consultations/admin";
import { purgeExpired } from "@/server/ai-consultations/retention";
import { recover } from "@/server/ai-consultations/ledger";
export async function savePublication(form: FormData) {
  const ctx = await adminContext();
  try {
    await updatePublication(ctx.client, ctx.scope, ctx.actor, {
      kind: form.get("kind"),
      id: form.get("id"),
      enabled: form.get("enabled") === "true",
      expectedVersion: Number(form.get("expectedVersion")),
    });
  } catch {
    throw new Error("AI_OPERATION_DENIED");
  }
  revalidatePath("/ai-consultations");
}
export async function saveGuidance(form: FormData) {
  const ctx = await adminContext();
  try {
    await updateGuidance(ctx.client, ctx.scope, ctx.actor, {
      topic: form.get("topic"),
      approved: form.get("approved") === "true",
      expectedVersion: Number(form.get("expectedVersion")),
    });
  } catch {
    throw new Error("AI_OPERATION_DENIED");
  }
  revalidatePath("/ai-consultations");
}
export async function retryRetention() {
  const ctx = await adminContext();
  await purgeExpired(ctx.client, ctx.scope, new Date());
  revalidatePath("/ai-consultations");
}
export async function recoverRequests() {
  const ctx = await adminContext();
  await recover(ctx.client, ctx.scope, new Date());
  revalidatePath("/ai-consultations");
}
