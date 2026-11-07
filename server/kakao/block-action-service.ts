import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { blockNewSends, type RuntimeRepository } from "@/server/kakao/runtime-settings";

export const blockReason = z.enum(["operator_stop", "provider_incident", "cost_incident", "security_incident", "recovery_pending"]);
type Status = { blocked: boolean; revision: number };
export type BlockResult = "blocked" | "already_blocked" | "conflict_blocked" | "failed";

/** Only a revision conflict can be reported as a concurrent block; other errors fail closed. */
export async function stopNewSends(input: { actorId: string; reason: unknown }, deps: { read: () => Promise<Status | null>; repository: RuntimeRepository; newId?: () => string; now?: () => Date }): Promise<BlockResult> {
  const reason = blockReason.safeParse(input.reason);
  if (!reason.success) return "failed";
  try {
    const current = await deps.read();
    if (!current) return "failed";
    if (current.blocked) return "already_blocked";
    try {
      await blockNewSends(deps.repository, { actorId: input.actorId, reason: reason.data, commandId: (deps.newId ?? randomUUID)(), expectedRevision: current.revision, at: (deps.now ?? (() => new Date()))() });
      return "blocked";
    } catch (error) {
      if (error instanceof Error && error.message === "Runtime revision conflict.") {
        const latest = await deps.read();
        if (latest?.blocked) return "conflict_blocked";
      }
      return "failed";
    }
  } catch { return "failed"; }
}
