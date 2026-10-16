import { previewPlaywrightArguments } from "./preview-focus";
import {
  readPreviewE2eConfiguration,
  type PreviewE2eConfiguration,
} from "./preview-runner";
import { readKeys } from "@/lib/ai-consultations/crypto";
import { readLimits } from "@/server/ai-consultations/ledger";
/** Caller creates no Prisma client until fixed selection/configuration validation succeeds. */
export function readPreviewInvocationConfiguration(
  environment: NodeJS.ProcessEnv,
  configurationReader: (
    env: NodeJS.ProcessEnv,
  ) => PreviewE2eConfiguration = readPreviewE2eConfiguration,
) {
  previewPlaywrightArguments(environment.PREVIEW_E2E_FOCUS);
  if ((environment.PREVIEW_E2E_FOCUS === "PHASE21" || environment.PREVIEW_E2E_FOCUS === "AI_SERVICE")) {
    readKeys(environment);
    readLimits(environment);
  }
  return configurationReader(environment);
}
