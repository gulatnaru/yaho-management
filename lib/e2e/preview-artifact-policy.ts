import path from "node:path";
export const PREVIEW_NO_COPY_PROMPT="1";
/** Raw per-test output is temporary and removed; durable reporting uses fixed safe artifacts. */
export function previewArtifactPolicy(proofPath:string|undefined) {
 if(!proofPath || !path.isAbsolute(proofPath))throw new Error("PREVIEW_ARTIFACT_PROOF_REQUIRED");
 return {outputDir:path.join(path.dirname(proofPath),"playwright-output"),preserveOutput:"never" as const};
}
