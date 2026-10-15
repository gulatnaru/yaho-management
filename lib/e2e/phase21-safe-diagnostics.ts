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

const ADMIN_OPERATIONS=["P21_ADMIN_CONTEXT","P21_ADMIN_DISABLE","P21_ADMIN_ENABLE","P21_ADMIN_GUIDANCE","P21_ADMIN_RETENTION"] as const;
export function phase21SafeOperation(steps:readonly {title:string;error?:unknown;steps?:readonly unknown[]}[],depth=0):string {
 if(depth>8)return "UNKNOWN";
 for(const step of steps.slice(0,100)){
   const nested=phase21SafeOperation((step.steps??[]) as typeof steps,depth+1);
   if(nested!=="UNKNOWN")return nested;
   if(step.error && (ADMIN_OPERATIONS as readonly string[]).includes(step.title))return step.title;
 }
 return "UNKNOWN";
}

export const PHASE21_PG_STAGES=["CONNECT","DUPLICATE","PENDING","QUOTA","DISPATCH","SETTLE","CONSTRAINTS","RECOVERY","PURGE"] as const;
export type PgVerificationStage=typeof PHASE21_PG_STAGES[number];
export function phase21SafePgFailure(message:string|undefined) {
 const empty={pgStage:"UNKNOWN",pgObservedCode:"UNKNOWN",pgCallerLine:null as number|null};
 const match=message?.match(/^(?:Error: )?P21_PG_FAILURE:(CONNECT|DUPLICATE|PENDING|QUOTA|DISPATCH|SETTLE|CONSTRAINTS|RECOVERY|PURGE):(P2028|P2010|P2002|P2034|UNKNOWN):(\d{1,5})$/);
 if(!match)return empty;
 const line=Number(match[3]);
 return{pgStage:match[1],pgObservedCode:match[2],pgCallerLine:Number.isSafeInteger(line)&&line>0&&line<=10000?line:null};
}
