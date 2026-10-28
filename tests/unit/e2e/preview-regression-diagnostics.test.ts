import {it,expect} from "vitest";
import {previewRegressionSafeFailure} from "@/lib/e2e/preview-regression-diagnostics";
it("retains only approved code locations, outcome tuples and attendance enums",()=>{
 const p=previewRegressionSafeFailure("PRIVATE at tests/e2e/phase20-postgres-races.spec.ts:136:11","Error: PHASE20_RACE_OUTCOME:PRISMA_P2028,FULFILLED",97);
 expect(p).toMatchObject({stage:"PHASE20_POSTGRES",line:136,testLine:97,diagnostic:"PHASE20_RACE_OUTCOME:PRISMA_P2028,FULFILLED"});
 expect(JSON.stringify(p)).not.toContain("PRIVATE");
 expect(previewRegressionSafeFailure(undefined,"P11_ATTENDANCE_DIAGNOSTIC:POST_SEEN:HTTP_2XX:REQUEST_FINISHED:COMPLETED:PRESENT",424).diagnostic).toContain("COMPLETED:PRESENT");
 for(const value of ["PHASE20_RACE_OUTCOME:PRISMA_P2028,SECRET","PHASE20_RACE_OUTCOME:FULFILLED,OTHER_REJECTION PRIVATE","P11_ATTENDANCE_DIAGNOSTIC:POST_SEEN:200:PRIVATE:COMPLETED:PRESENT","PRIVATE"])
 expect(previewRegressionSafeFailure("PRIVATE",value,0)).toEqual({stage:"UNKNOWN",source:"NONE",line:null,testLine:null,diagnostic:"UNKNOWN"});
});
