const SOURCES={
 "tests/e2e/phase11-core-operations.spec.ts":"CORE_ATTENDANCE",
 "tests/e2e/phase20-postgres-races.spec.ts":"PHASE20_POSTGRES",
 "tests/e2e/support/phase20-race-barrier.ts":"PHASE20_BARRIER",
} as const;
const OUTCOMES=new Set(["FULFILLED","APPLICATION_NOT_PENDING","INSUFFICIENT_DEPOSIT","PAYMENT_ALREADY_EXISTS","OVERBOOKING_CONFIRMATION","PRISMA_UNKNOWN_REQUEST","OTHER_REJECTION",... ["P1001","P1002","P1008","P1017","P2002","P2003","P2010","P2021","P2022","P2024","P2025","P2027","P2028","P2034"].map(code=>"PRISMA_"+code),... ["23503","23505","40001","40P01","42P01","42703","55P03"].map(code=>"PRISMA_P2010_SQL_"+code)]);
export function previewRegressionSafeFailure(stack:string|undefined,message:string|undefined,testLine:number|undefined){
 const boundedTestLine=testLine!==undefined&&Number.isSafeInteger(testLine)&&testLine>0&&testLine<=10000?testLine:null;
 const failure={stage:"UNKNOWN",source:"NONE",line:null as number|null,testLine:boundedTestLine,diagnostic:"UNKNOWN"};
 for(const frame of (stack??"").split(/\r?\n/)){
  const normalized=frame.replaceAll("\\","/");
  for(const [source,stage] of Object.entries(SOURCES)){
   if(!normalized.includes(source+":"))continue;
   const line=Number(normalized.match(/:(\d+):\d+\)?$/)?.[1]);
   if(Number.isSafeInteger(line)&&line>0&&line<=10000){failure.source=source;failure.stage=stage;failure.line=line;break;}
  }
  if(failure.line!==null)break;
 }
 const fixed=message?.replace(/^Error: /,"")??"";
 if(/^PHASE20_RACE_(A_LOCK_UNAVAILABLE|B_PID_UNAVAILABLE|EXPECTED_WAIT_TIMEOUT|OBSERVER_FAILED)$/.test(fixed))failure.diagnostic=fixed;
 const outcomes=fixed.match(/^PHASE20_RACE_OUTCOME:([A-Z0-9_]+),([A-Z0-9_]+)$/);
 if(outcomes&&OUTCOMES.has(outcomes[1]!)&&OUTCOMES.has(outcomes[2]!))failure.diagnostic=fixed;
 if(/^P11_ATTENDANCE_DIAGNOSTIC:(POST_SEEN|POST_NOT_SEEN):(HTTP_2XX|HTTP_NON2XX|NO_RESPONSE):(REQUEST_FINISHED|REQUEST_PENDING|REQUEST_FAILED):(RESERVED|COMPLETED|NO_SHOW|CANCELLED|UNKNOWN):(PRESENT|ABSENT|NONE|UNKNOWN)$/.test(fixed))failure.diagnostic=fixed;
 return failure;
}
