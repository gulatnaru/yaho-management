import {Prisma,type PrismaClient} from "@prisma/client";
import {SYNTHETIC_FACTS} from "@/server/ai-consultations/tools";
import {ValidationDenied,type ValidationContext} from "./rollback";
export function isLockTimeout(error:unknown){
 return error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2010"&&error.meta?.code==="55P03";
}
export async function verifyIndependentLocks(context:ValidationContext,other:PrismaClient){
 const sourceId=context.scope.manifest.programIds[0];
 if(!sourceId||!sourceId.startsWith("ai-program-"+context.scope.runId+"-"))throw new ValidationDenied();
 const source=await context.tx.program.findUnique({where:{id:sourceId},select:{name:true}});
 if(source?.name!==SYNTHETIC_FACTS.name)throw new ValidationDenied();
 const a=await context.tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`;
 await context.tx.$queryRaw`SELECT id FROM "Program" WHERE id=${sourceId} FOR SHARE`;
 let distinct=false;
 async function blocked(lock:"DOMAIN"|"SOURCE"){
  try{
   await other.$transaction(async tx=>{
    await tx.$executeRaw`SET LOCAL lock_timeout = '50ms'`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '1000ms'`;
    const b=await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`;
    if(!a[0]?.pid||!b[0]?.pid||a[0].pid===b[0].pid)throw new ValidationDenied();distinct=true;
    if(lock==="DOMAIN")await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('ai-service:PREVIEW',21062))`;
    else await tx.$queryRaw`SELECT id FROM "Program" WHERE id=${sourceId} FOR UPDATE`;
   },{maxWait:1000,timeout:2000});
  }catch(error){if(isLockTimeout(error))return true;throw new ValidationDenied();}
  throw new ValidationDenied();
 }
 const domain=await blocked("DOMAIN"),sourceLock=await blocked("SOURCE");
 return{independentBackends:distinct,domainLockTimeout:domain,ownedSourceRowLockTimeout:sourceLock};
}
export async function verifyReleasedLocks(other:PrismaClient,sourceId:string){
 await other.$transaction(async tx=>{
  await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
  const rows=await tx.$queryRaw<Array<{free:boolean}>>`SELECT pg_try_advisory_xact_lock(hashtextextended('ai-service:PREVIEW',21062)) AS free`;
  if(rows[0]?.free!==true)throw new ValidationDenied();
  const source=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "Program" WHERE id=${sourceId} FOR UPDATE`;
  if(source.length!==1)throw new ValidationDenied();
 },{maxWait:1000,timeout:2000});
}
