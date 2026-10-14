import {describe,expect,it} from "vitest";
import {phase21SafeFailureLocation,phase21SafeOperation} from "@/lib/e2e/phase21-safe-diagnostics";
describe("Phase21 fixed-only failure diagnostics",()=>{
 it("emits only fixed operation names, ignoring private step titles and errors",()=>{
   expect(phase21SafeOperation([{title:"PRIVATE",error:"PRIVATE_ERROR",steps:[{title:"P21_ADMIN_ENABLE",error:"PRIVATE_BODY"}]}])).toBe("P21_ADMIN_ENABLE");
   expect(phase21SafeOperation([{title:"PRIVATE_BODY",error:"PRIVATE_ERROR"}])).toBe("UNKNOWN");
 });
 it("keeps only approved file/line/stage and never error messages/absolute paths/identities",()=>{
  const stack="Error: PRIVATE_BODY_SECRET\n at C:/private-user/project/server/ai-consultations/ledger.ts:118:11\n at arbitrary-secret.ts:1:2";
  const safe=phase21SafeFailureLocation(stack,25);
  expect(safe).toEqual({stage:"LEDGER",source:"server/ai-consultations/ledger.ts",line:118,testLine:25});
  expect(JSON.stringify(safe)).not.toMatch(/PRIVATE|private-user|arbitrary-secret/);
 });
 it("unknown or malformed locations remain fixed UNKNOWN",()=>{
  expect(phase21SafeFailureLocation("SECRET in foreign.ts:22:5",4)).toEqual({stage:"UNKNOWN",source:"NONE",line:null,testLine:4});
  expect(phase21SafeFailureLocation("server/ai-consultations/ledger.ts:999999:1",-1)).toEqual({stage:"UNKNOWN",source:"NONE",line:null,testLine:null});
 });
});
