import type { PrismaClient } from "@prisma/client";
import type { Scope } from "@/lib/ai-consultations/contracts";
import { runRetentionCycle } from "./retention";
/** Explicit test harness only. Nothing imports/starts this scheduler in deployed runtime. */
export function syntheticRetentionScheduler(
  client: PrismaClient,
  scope: Scope,
  clock: () => Date,
  intervalMs = 60000,
) {
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped) return;
    try {
      await runRetentionCycle(client, scope, clock);
    } catch {
      // The scoped worker records fixed failure state; never propagate raw diagnostics from a timer.
    } finally {
      if (!stopped)
        timer = setTimeout(() => {
          void tick();
        }, intervalMs);
    }
  };
  return {
    start() {
      if (!stopped) return;
      stopped = false;
      timer = setTimeout(() => {
        void tick();
      }, intervalMs);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
