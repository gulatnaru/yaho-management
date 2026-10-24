import type {PrismaClient} from "@prisma/client";
import {readRuntimeDatabaseIdentity} from "@/lib/e2e/preview-runner";
import {assertApprovedRuntimeDatabaseIdentity,prismaSchemaTargetFromDatabaseUrl} from "@/lib/e2e/preview-safety";
import {assertMockEnvironment,verifyProof,authorizeScope,readBoundedBody,AI_PROOF_HEADER} from "@/server/ai-consultations/runtime";
import {requestSchema,runScenario} from "./scenarios";
import {runRollbackValidation,ValidationDenied,VALIDATION_PURPOSE,SERVICE_MIGRATION,SERVICE_MIGRATION_SHA256} from "./rollback";
import {verifyIndependentLocks,verifyReleasedLocks} from "./locks";
export type PreviewValidationDependencies={environment:NodeJS.ProcessEnv;client:()=>Promise<PrismaClient>;otherClient:()=>Promise<PrismaClient>;};
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export function previewValidationHandler(deps:PreviewValidationDependencies){
 return async(request:Request)=>{
  // No NODE_ENV, payload flag, auth claim or arbitrary URL can enable Production.
  try{assertMockEnvironment(deps.environment);if(deps.environment.PREVIEW_E2E_SUPABASE_PROJECT_REF!=="azlfamqrmbfsvjnpozmr")throw new ValidationDenied();}
  catch{return Response.json({ok:false,error:"AI_SERVICE_VALIDATION_DENIED"},{status:503,headers});}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
  let other:PrismaClient|undefined;
  try{
   const body=await readBoundedBody(request,controller.signal);
   const parsed=requestSchema.safeParse(JSON.parse(body));if(!parsed.success)throw new ValidationDenied();
   const proof=verifyProof(request.headers.get(AI_PROOF_HEADER),body,VALIDATION_PURPOSE,deps.environment,new Date());
   const client=await deps.client(),scope=await authorizeScope(client,proof,deps.environment,new Date());
   // The ownership guard checks approved runtime DB identity and the runner's global lock.
   const migrations=await client.$queryRaw<Array<{migration_name:string;checksum:string;finished_at:Date|null;rolled_back_at:Date|null}>>`SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations"`;
   if(migrations.some(row=>!row.finished_at&&!row.rolled_back_at)||!migrations.some(row=>row.migration_name===SERVICE_MIGRATION&&row.checksum.toLowerCase()===SERVICE_MIGRATION_SHA256&&row.finished_at&&!row.rolled_back_at))throw new ValidationDenied();
   if(parsed.data.scenario==="LOCKS"){
    other=await deps.otherClient();
    const identity=await readRuntimeDatabaseIdentity(other);
    assertApprovedRuntimeDatabaseIdentity(identity,deps.environment.PREVIEW_E2E_SUPABASE_PROJECT_REF!,deps.environment.PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256,prismaSchemaTargetFromDatabaseUrl(deps.environment.DIRECT_URL));
   }
   const result=await runRollbackValidation(client,scope,c=>runScenario(c,parsed.data.scenario,other?()=>verifyIndependentLocks(c,other!):undefined));
   if(other)await verifyReleasedLocks(other,scope.manifest.programIds[0]);
   if(controller.signal.aborted)throw new ValidationDenied();
   return Response.json(result,{headers});
  }catch{return Response.json({ok:false,error:"AI_SERVICE_VALIDATION_DENIED"},{status:403,headers});}
  finally{clearTimeout(timer);controller.abort();await other?.$disconnect();}
 };
}
