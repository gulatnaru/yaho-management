import {randomBytes,randomUUID} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import type {Scope} from "@/lib/ai-consultations/contracts";
import type {Tx,Database} from "../repository";
import type {Keys} from "../crypto";
import {saveConfig,saveGuidance,savePublication} from "../admin";
export const SERVICE_MIGRATION="20261015090000_ai_service_followup";
export const SERVICE_MIGRATION_SHA256="bacd02b4a1c69e19c891d0c122f08bf9f715b6d0b2e43f5899d92c329fee1b7f";
export const VALIDATION_PURPOSE="POST:/api/e2e/ai-service-validation";
export const SYNTHETIC_GUIDANCE="합성 준비물은 모자입니다.";
export class ValidationDenied extends Error{constructor(){super("AI_SERVICE_VALIDATION_DENIED");}}
export async function countServiceRows(db:Tx){
 const counts=await Promise.all([db.aiServiceConfig.count(),db.aiServiceProgramPublication.count(),db.aiServiceClassPublication.count(),db.aiServiceKnowledgeEntry.count(),db.aiServiceRequest.count(),db.aiServiceBudgetMonth.count(),db.aiServiceQuotaBucket.count(),db.aiServiceDailyMetric.count(),db.aiServiceRetentionJob.count(),db.aiServiceKeyPin.count(),db.aiServiceReconciliation.count()]);
 return counts.reduce((sum,count)=>sum+count,0);
}
/** Serial savepoints compose real domain transactions inside an ALWAYS-rollback fixture.
 * This does not prove commit-mediated concurrent financial requests or pool maxWait.
 */
export function scopedDatabase(tx:Tx):Database{
 let tail=Promise.resolve();
 const transaction=async<T>(fn:(connection:Tx)=>Promise<T>)=>{
  const previous=tail;let release!:()=>void;tail=new Promise<void>(resolve=>{release=resolve;});await previous;
  try{
   await tx.$executeRaw`SAVEPOINT ai_service_validation_step`;
   try{const result=await fn(tx);await tx.$executeRaw`RELEASE SAVEPOINT ai_service_validation_step`;return result;}
   catch(error){await tx.$executeRaw`ROLLBACK TO SAVEPOINT ai_service_validation_step`;await tx.$executeRaw`RELEASE SAVEPOINT ai_service_validation_step`;throw error;}
  }finally{release();}
 };
 return{$transaction:transaction} as unknown as Database;
}
export type ValidationContext={tx:Tx;db:Database;scope:Scope;now:Date;keys:Keys;actor:{userId:string;role:string;active:boolean};programId:string;classId:string;};
export type ValidationResult={scenario:string;checks:Record<string,boolean>;externalProviderCalls:0;syntheticProviderCalls:number;rollbackVerified:boolean;};
class RollbackResult extends Error{constructor(readonly result:ValidationResult){super("AI_SERVICE_VALIDATION_ROLLBACK");}}
export async function runRollbackValidation(client:PrismaClient,scope:Scope,run:(context:ValidationContext)=>Promise<ValidationResult>){
 const now=new Date(),programId="service-program-"+scope.runId+"-"+randomUUID(),classId="service-class-"+scope.runId+"-"+randomUUID();
 let result:ValidationResult|undefined;let failed=false;
 try{
  await client.$transaction(async tx=>{
   await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
   await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('ai-service:PREVIEW',21062))`;
   // No existing AiService config, pins, obligations or privacy rows may be touched.
   if(await countServiceRows(tx)!==0)throw new ValidationDenied();
   const db=scopedDatabase(tx),actor={userId:"synthetic-"+scope.runId,role:"ADMIN",active:true};
   const keys:Keys={encryption:{v1:randomBytes(32)},hmac:{v1:randomBytes(32)},activeEncryption:"v1",activeHmac:"v1"};
   await tx.program.create({data:{id:programId,name:"합성 야호 숲체험",description:"숲에서 배우는 합성 안내",status:"ACTIVE",updatedAt:now}});
   await tx.classSchedule.create({data:{id:classId,programId,startsAt:new Date(+now+86400000),endsAt:new Date(+now+90000000),location:"합성 숲",capacity:8,status:"SCHEDULED",updatedAt:now}});
   await saveConfig(db,"PREVIEW",actor,{expectedVersion:0,paused:false,provider:"TEST_DOUBLE",model:"gpt-6-luna",priceVersion:"synthetic-validation-v1",inputNanoUsdPerToken:100,outputNanoUsdPerToken:500,fxMilliKrwPerUsd:1400000,fxCheckedAt:now,fxSource:"synthetic-only"},now);
   await saveGuidance(db,"PREVIEW",actor,{topic:"PREPARATION",content:SYNTHETIC_GUIDANCE,approved:true,expectedVersion:0});
   await savePublication(db,"PREVIEW",actor,{kind:"PROGRAM",id:programId,enabled:true,expectedVersion:0});
   await savePublication(db,"PREVIEW",actor,{kind:"CLASS",id:classId,enabled:true,expectedVersion:0});
   const output=await run({tx,db,scope,now,keys,actor,programId,classId});
   if(Object.values(output.checks).some(value=>value!==true))throw new ValidationDenied();
   throw new RollbackResult(output);
  },{maxWait:1000,timeout:20000});
 }catch(error){if(error instanceof RollbackResult)result=error.result;else failed=true;}
 // Do not delete permanent rows. Verify that rollback removed the entire fixture.
 if(await countServiceRows(client as unknown as Tx)!==0||await client.program.count({where:{id:programId}})!==0||await client.classSchedule.count({where:{id:classId}})!==0)throw new ValidationDenied();
 if(failed||!result)throw new ValidationDenied();
 return{...result,rollbackVerified:true};
}
