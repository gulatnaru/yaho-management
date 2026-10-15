import path from "node:path";
import {pathToFileURL} from "node:url";
import {loadEnvConfig} from "@next/env";
import {Prisma,PrismaClient} from "@prisma/client";
import {runIdSchema} from "@/lib/ai-consultations/contracts";
import {readPreviewE2eConfiguration,assertPreviewDatabasePreflight,withPreviewDatabaseLock} from "@/lib/e2e/preview-runner";
import {cleanupPhase21PreviewRun} from "@/lib/e2e/phase21-cleanup";
import {cleanupPhase20PreviewRun} from "@/lib/e2e/phase20-cleanup";
import {cleanupPreviewRun,type PreviewCleanupClient} from "@/lib/e2e/preview-cleanup";
import {cleanupPreviewRunPhases} from "@/lib/e2e/preview-cleanup-phases";

export function recoveryIdentity(runId:string|undefined,sha:string|undefined) {
  if(!runIdSchema.safeParse(runId).success || !/^[a-f0-9]{40}$/.test(sha??""))throw new Error("P21_RECOVERY_IDENTITY_DENIED");
  return{runId:runId!,deploymentSha:sha!};
}
const failedPhases:string[]=[];
async function main(){
 const owned=recoveryIdentity(process.argv[2],process.argv[3]);
 if(process.env.PHASE21_PREVIEW_RECOVERY_APPROVED!=="1")throw new Error("P21_RECOVERY_APPROVAL_REQUIRED");
 loadEnvConfig(process.cwd(),true,{info:()=>{},error:()=>{}},true);
 const c=readPreviewE2eConfiguration();
 if(c.previewProjectRef!==process.env.PHASE21_APPROVED_PREVIEW_PROJECT_REF || c.productionProjectRef!==process.env.PHASE21_DENIED_PRODUCTION_PROJECT_REF || process.env.VERCEL_ENV==="production")throw new Error("P21_RECOVERY_TARGET_DENIED");
 const db=new PrismaClient({datasourceUrl:c.databaseUrl}),direct=new PrismaClient({datasourceUrl:c.directUrl});
 try{
  await assertPreviewDatabasePreflight({databaseClient:db,directClient:direct,approvedRuntimeFingerprint:c.approvedRuntimeFingerprint,previewProjectRef:c.previewProjectRef,databaseSchema:c.databaseSchema,directSchema:c.directSchema,migrationRoot:path.resolve("prisma/migrations")});
  // Recovery deliberately accepts the failed lease's exact old SHA. It never rewrites/relabels ownership to HEAD.
  let lockLost=false;
  await withPreviewDatabaseLock({client:direct,onSessionLost:()=>{lockLost=true;},run:async lock=>{
   const lease=await db.previewE2eRunLease.findUnique({where:{runId:owned.runId},select:{deploymentSha:true}});
   if(!lease || lease.deploymentSha!==owned.deploymentSha)throw new Error("P21_RECOVERY_LEASE_DENIED");
   const guarded=async<T>(phase:string,fn:()=>Promise<T>)=>{try{if(lockLost)throw new Error("P21_RECOVERY_LOCK_LOST");return await fn();}catch{failedPhases.push(phase);throw new Error("P21_RECOVERY_PHASE_FAILED");}};
   await cleanupPreviewRunPhases({
    phase21:()=>guarded("PHASE21",async()=>{const r=await cleanupPhase21PreviewRun(db,owned);if(r.residualAiRows || r.residualPrograms || r.residualClasses)throw new Error("P21_RECOVERY_RESIDUAL");}),
    phase20:()=>guarded("PHASE20",async()=>{const r=await cleanupPhase20PreviewRun(db,owned.runId);if(r.residualGroups)throw new Error("P21_RECOVERY_RESIDUAL");}),
    legacy:()=>guarded("LEGACY",()=>cleanupPreviewRun(db as unknown as PreviewCleanupClient,owned.runId)),
    releaseLease:()=>guarded("LEASE",async()=>{
     const deleted=await lock.$queryRaw<Array<{id:string}>>`DELETE FROM "PreviewE2eRunLease" WHERE "runId"=${owned.runId} AND "deploymentSha"=${owned.deploymentSha} AND "aiFixtureManifest" IS NULL RETURNING id`;
     if(deleted.length!==1)throw new Error("P21_RECOVERY_LEASE_DENIED");
    }),
   });
  }});
  console.log(JSON.stringify({result:"PASS",target:"APPROVED_PREVIEW",residualAiRows:0,residualPrograms:0,residualClasses:0,leaseReleased:true}));
 }finally{await Promise.all([db.$disconnect(),direct.$disconnect()]);}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch((error:unknown)=>{
 const code=error instanceof Prisma.PrismaClientKnownRequestError?error.code:error instanceof Error && /^P21_RECOVERY_[A-Z_]+$/.test(error.message)?error.message:"P21_RECOVERY_FAILED";
 console.error(JSON.stringify({result:"FAIL",code,failedPhases}));process.exitCode=1;
});
