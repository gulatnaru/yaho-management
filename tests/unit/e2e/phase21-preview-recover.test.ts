import {describe,expect,it} from "vitest";
import {recoveryIdentity} from "@/scripts/e2e/phase21-preview-recover";
describe("exact failed-run recovery identity",()=>{
 it("retains an explicitly supplied old SHA and refuses malformed or missing ownership",()=>{
  const run="preview-abcdefghijklmnopqrstuv",sha="a".repeat(40);
  expect(recoveryIdentity(run,sha)).toEqual({runId:run,deploymentSha:sha});
  for(const [r,s]of [[undefined,sha],["arbitrary",sha],[run,undefined],[run,"HEAD"],[run,"b".repeat(39)]])expect(()=>recoveryIdentity(r,s)).toThrow("P21_RECOVERY_IDENTITY_DENIED");
 });
});
