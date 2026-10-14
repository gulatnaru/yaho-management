export const PHASE21_SAFE_FAILURE_SOURCES = {
 "tests/e2e/support/phase21-fixtures.ts":"FIXTURE",
 "tests/integration/phase21-postgres.ts":"POSTGRES",
 "tests/e2e/phase21-ai-consultations.spec.ts":"HTTP_OR_ADMIN",
 "lib/e2e/phase21-cleanup.ts":"CLEANUP",
 "server/ai-consultations/ledger.ts":"LEDGER",
 "server/ai-consultations/runtime.ts":"RUNTIME",
} as const;
/** Errors remain memory-only. Only an allowlisted code file and bounded numeric location can persist. */
export function phase21SafeFailureLocation(stack:string|undefined,testLine:number|undefined) {
 const fallback={stage:"UNKNOWN",source:"NONE",line:null as number|null,testLine:testLine!==undefined&&Number.isSafeInteger(testLine)&&testLine>0&&testLine<=10000?testLine:null};
 if(!stack)return fallback;
 for(const frame of stack.split(/\r?\n/)){
  const normalized=frame.replaceAll("\\","/");
  for(const [source,stage]of Object.entries(PHASE21_SAFE_FAILURE_SOURCES)){
   if(!normalized.includes(source+":"))continue;
   const match=normalized.match(/:(\d+):\d+\)?$/),line=Number(match?.[1]);
   if(Number.isSafeInteger(line)&&line>0&&line<=10000)return{stage,source,line,testLine:fallback.testLine};
  }
 }
 return fallback;
}
