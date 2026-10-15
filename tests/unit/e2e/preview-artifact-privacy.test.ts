import path from "node:path";
import {it,expect} from "vitest";
import {previewArtifactPolicy,PREVIEW_NO_COPY_PROMPT} from "@/lib/e2e/preview-artifact-policy";
it("keeps raw output only inside the owned runner proof directory and never preserves it",()=>{const proof=path.resolve("synthetic-proof/runner-proof");expect(previewArtifactPolicy(proof)).toEqual({outputDir:path.join(path.dirname(proof),"playwright-output"),preserveOutput:"never"});expect(PREVIEW_NO_COPY_PROMPT).toBe("1");});
it("requires an absolute runner proof path",()=>{for(const value of [undefined,"relative-proof"])expect(()=>previewArtifactPolicy(value)).toThrow("PREVIEW_ARTIFACT_PROOF_REQUIRED");});
