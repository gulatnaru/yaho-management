import {describe,it,expect,vi,afterEach} from "vitest";
import {parsePreviewLocalEnvironment,previewChildEnvironment,previewPrismaEnvironment,readPreviewLocalEnvironment} from "@/lib/e2e/preview-environment";
import {Prisma,type PrismaClient} from "@prisma/client";
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import os from "node:os";import path from "node:path";
import {previewValidationHandler} from "@/server/ai-service/preview/handler";
import {runRollbackValidation,scopedDatabase,VALIDATION_PURPOSE,SERVICE_MIGRATION} from "@/server/ai-service/preview/rollback";
import {runScenario} from "@/server/ai-service/preview/scenarios";
import * as serviceAdmin from "@/server/ai-service/admin";
import {isLockTimeout} from "@/server/ai-service/preview/locks";
import type {Tx} from "@/server/ai-service/repository";
import {createPhase21MockKeys,assertPhase21ValidationBranch} from "@/scripts/e2e/phase21-preview-environment";
import {readKeys} from "@/lib/ai-consultations/crypto";
import {proofSignature,manifestDigest,AI_PROOF_HEADER} from "@/server/ai-consultations/runtime";
import {previewPlaywrightArguments,previewTestSourcesForFocus} from "@/lib/e2e/preview-focus";
import {PREVIEW_E2E_TEST_FILES} from "@/lib/e2e/preview-runner";
import {buildSafePreviewTestCounts} from "@/lib/e2e/preview-test-counts";
import {evaluateAiServicePreviewMigration,previewMigrationScope} from "@/scripts/e2e/ai-service-preview-migration-policy";
import {listRepositoryMigrations,migrationChecksum} from "@/scripts/release/production-migration";
import {fakeDb} from "./fake-db";
import type {Scope} from "@/lib/ai-consultations/contracts";
const runId="preview-"+"a".repeat(22),sha="a".repeat(40),uuid="00112233-4455-4677-8899-aabbccddeeff";
const scope:Scope={runId,deploymentSha:sha,manifest:{version:1,programIds:["ai-program-"+runId+"-"+uuid],classIds:["ai-class-"+runId+"-"+uuid],subjectIds:["synthetic-"+runId.slice(8)+"-"+"b".repeat(12)]}};
function environment():NodeJS.ProcessEnv{return{...createPhase21MockKeys(),VERCEL_ENV:"preview",VERCEL:"1",VERCEL_GIT_COMMIT_SHA:sha,DATABASE_URL:"postgresql://postgres.azlfamqrmbfsvjnpozmr:synthetic@db.azlfamqrmbfsvjnpozmr.supabase.co:5432/postgres",DIRECT_URL:"postgresql://postgres.azlfamqrmbfsvjnpozmr:synthetic@db.azlfamqrmbfsvjnpozmr.supabase.co:5432/postgres",PREVIEW_E2E_SUPABASE_PROJECT_REF:"azlfamqrmbfsvjnpozmr",PRODUCTION_E2E_SUPABASE_PROJECT_REF:"panoeqaatreixjltrekv"};}
function request(env:NodeJS.ProcessEnv,body=JSON.stringify({scenario:"FLOW"}),purpose=VALIDATION_PURPOSE){
 const issued=Date.now(),manifestHash=manifestDigest(scope.manifest),signature=proofSignature(readKeys(env),{runId,sha,issued,manifestHash,purpose,body});
 return new Request("https://synthetic.vercel.app/api/e2e/ai-service-validation",{method:"POST",headers:{"content-type":"application/json",[AI_PROOF_HEADER]:[runId,sha,issued,manifestHash,signature].join(".")},body});
}
async function fakeClient(){
 const f=fakeDb();let tx!:Tx;await f.db.$transaction(async connection=>{tx=connection;});
 type Delegate={findFirst:(args?:unknown)=>Promise<unknown>;findUnique:(args?:unknown)=>Promise<unknown>;findFirstOrThrow?:(args?:unknown)=>Promise<unknown>;findUniqueOrThrow?:(args?:unknown)=>Promise<unknown>;};
 for(const name of Object.keys(f.state)){const d=(tx as unknown as Record<string,Delegate>)[name];d.findFirstOrThrow=async args=>{const row=await d.findFirst(args);if(!row)throw new Error("MISSING_SYNTHETIC");return row;};d.findUniqueOrThrow=async args=>{const row=await d.findUnique(args);if(!row)throw new Error("MISSING_SYNTHETIC");return row;};}
 const create=tx.classSchedule.create.bind(tx.classSchedule);
 tx.classSchedule.create=(async args=>{const result=await create(args);const row=f.state.classSchedule.find(item=>item.id===result.id);if(row){row.program=f.state.program.find(item=>item.id===result.programId);row._count={reservations:0};}return result;}) as typeof create;
 return{f,tx,client:{...tx,$transaction:f.db.$transaction} as unknown as PrismaClient};
}
describe("Preview-only rollback validation guard",()=>{
 it.each(["production","development",undefined])("denies %s before body or database factory",async VERCEL_ENV=>{
  const env={...environment(),VERCEL_ENV,NODE_ENV:"test" as const},client=vi.fn(),otherClient=vi.fn();
  const response=await previewValidationHandler({environment:env,client,otherClient})(request(env));
  expect(response.status).toBe(503);expect(client).not.toHaveBeenCalled();expect(otherClient).not.toHaveBeenCalled();
 });
 it("rejects Production or unapproved refs even with a preview flag",async()=>{
  const env={...environment(),PREVIEW_E2E_SUPABASE_PROJECT_REF:"panoeqaatreixjltrekv"},client=vi.fn(),otherClient=vi.fn();
  expect((await previewValidationHandler({environment:env,client,otherClient})(request(env))).status).toBe(503);expect(client).not.toHaveBeenCalled();
 });
 it("binds proof purpose and body before any client",async()=>{
  const env=environment(),client=vi.fn(),otherClient=vi.fn(),handler=previewValidationHandler({environment:env,client,otherClient});
  expect((await handler(request(env,JSON.stringify({scenario:"FLOW"}),"POST:/api/ai-consultations/mock-skill"))).status).toBe(403);
  expect((await handler(request(env,JSON.stringify({scenario:"FLOW",utterance:"synthetic-unapproved-input"})))).status).toBe(403);
  expect(client).not.toHaveBeenCalled();
 });
 it("accepts a valid bounded proof only as far as the client boundary",async()=>{
  const env=environment(),client=vi.fn(async()=>{throw new Error("SYNTHETIC_STOP");}),otherClient=vi.fn();
  expect((await previewValidationHandler({environment:env,client,otherClient})(request(env))).status).toBe(403);expect(client).toHaveBeenCalledOnce();expect(otherClient).not.toHaveBeenCalled();
 });
});
describe("rollback composition (repository doubles, not actual PG proof)",()=>{
 it.each(["FLOW","PUBLICATION","SECURITY","RETENTION","BUDGET"] as const)("executes synthetic %s and retains no rows",async scenario=>{
  const {f,client}=await fakeClient();const result=await runRollbackValidation(client,scope,c=>runScenario(c,scenario));
  expect(result.rollbackVerified).toBe(true);expect(Object.values(result.checks).every(Boolean)).toBe(true);
  expect(Object.values(f.state).every(rows=>rows.length===0)).toBe(true);
 });
 it("refuses any existing AiService row without changing or deleting it",async()=>{
  const {f,client}=await fakeClient();f.seed("aiServiceKeyPin",{environment:"PREVIEW",version:"v1",fingerprint:"a".repeat(64)});const before=structuredClone(f.state),run=vi.fn();
  await expect(runRollbackValidation(client,scope,run)).rejects.toThrow("AI_SERVICE_VALIDATION_DENIED");expect(f.state).toEqual(before);expect(run).not.toHaveBeenCalled();
 });
 it("callback failure still rolls fixture data back",async()=>{
  const {f,client}=await fakeClient();
  await expect(runRollbackValidation(client,scope,async()=>{throw new Error("SYNTHETIC_FAIL");})).rejects.toThrow("AI_SERVICE_VALIDATION_DENIED");
  expect(Object.values(f.state).every(rows=>rows.length===0)).toBe(true);
 });
 it("serial savepoint adapter restores the SQL error boundary and releases the queue",async()=>{
  const sql:string[]=[];const tx={$executeRaw:async (parts:TemplateStringsArray)=>{sql.push(parts.join(""));return 1;}} as unknown as Tx,db=scopedDatabase(tx);
  await expect(db.$transaction(async()=>{throw new Error("EXPECTED");})).rejects.toThrow("EXPECTED");
  expect(await db.$transaction(async()=>42)).toBe(42);
  expect(sql).toContain("ROLLBACK TO SAVEPOINT ai_service_validation_step");expect(sql.filter(value=>value.startsWith("RELEASE SAVEPOINT"))).toHaveLength(2);
 });
 it("recognises only an actual PG lock timeout as contention",()=>{
  const lock=new Prisma.PrismaClientKnownRequestError("synthetic",{code:"P2010",clientVersion:"synthetic",meta:{code:"55P03"}});
  expect(isLockTimeout(lock)).toBe(true);expect(isLockTimeout(new Error("timeout"))).toBe(false);
 });
});
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0)){if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+"ai-service-policy-"))throw new Error("TEMP_PATH_DENIED");rmSync(root,{recursive:true,force:true});}});
describe("fixed new scope preserves approved migration and old runner",()=>{
 it("adds one fixed suite while preserving default and Mock",()=>{
  expect(previewPlaywrightArguments("AI_SERVICE")).toEqual(["test","tests/e2e/phase21-ai-service.spec.ts"]);
  expect(previewPlaywrightArguments(undefined)).toEqual(["test",...PREVIEW_E2E_TEST_FILES]);
  expect(previewPlaywrightArguments("PHASE21")).toEqual(["test","tests/e2e/phase21-ai-consultations.spec.ts"]);
  expect(()=>previewPlaywrightArguments("AI_SERVICE --headed")).toThrow();
  expect(previewTestSourcesForFocus("AI_SERVICE")).toHaveLength(1);
  const report=buildSafePreviewTestCounts({focus:"AI_SERVICE",status:"passed",unapprovedSource:false,selected:[{source:"tests/e2e/phase21-ai-service.spec.ts",count:9}],results:Array.from({length:9},()=>({source:"tests/e2e/phase21-ai-service.spec.ts" as const,status:"passed" as const}))});
  expect(report.total).toMatchObject({selected:9,passed:9,unexecuted:0});
 });
 it("allows the exact follow-up branch and rejects caller-selected branches",()=>{
  expect(()=>assertPhase21ValidationBranch("feature/phase21-ai-service")).not.toThrow();expect(()=>assertPhase21ValidationBranch("feature/phase21-ai-service-extra")).toThrow();
 });
 it("allows only the approved fifteenth checksum and already-applied prior history",()=>{
  const root=path.resolve("prisma/migrations"),names=listRepositoryMigrations(root),rows=names.map(name=>({migration_name:name,checksum:migrationChecksum(root,name),finished_at:new Date(),rolled_back_at:null}));
  expect(evaluateAiServicePreviewMigration(rows.slice(0,-1),root)).toMatchObject({pendingMigrations:[SERVICE_MIGRATION],deployRequired:true});
  expect(evaluateAiServicePreviewMigration(rows,root)).toMatchObject({pendingMigrations:[],deployRequired:false});
  expect(()=>evaluateAiServicePreviewMigration(rows.slice(0,-2),root)).toThrow();
  expect(()=>evaluateAiServicePreviewMigration([...rows,rows[0]],root)).toThrow();
  expect(()=>evaluateAiServicePreviewMigration([{...rows[0],checksum:"0".repeat(64)},...rows.slice(1)],root)).toThrow();
 });
 it("refuses changed payload or a new unapproved migration without touching source",()=>{
  const source=path.resolve("prisma/migrations"),root=mkdtempSync(path.join(os.tmpdir(),"ai-service-policy-"));roots.push(root);
  for(const name of listRepositoryMigrations(source)){mkdirSync(path.join(root,name));writeFileSync(path.join(root,name,"migration.sql"),readFileSync(path.join(source,name,"migration.sql")));}
  const rows=listRepositoryMigrations(root).map(name=>({migration_name:name,checksum:migrationChecksum(root,name),finished_at:new Date(),rolled_back_at:null}));
  writeFileSync(path.join(root,SERVICE_MIGRATION,"migration.sql"),"-- changed");
  expect(()=>evaluateAiServicePreviewMigration(rows,root)).toThrow();
  mkdirSync(path.join(root,"20261017000000_unapproved"));writeFileSync(path.join(root,"20261017000000_unapproved","migration.sql"),"-- unapproved");
  expect(()=>evaluateAiServicePreviewMigration(rows,root)).toThrow();
 });
 it("keeps Mock the default migration scope and rejects arbitrary selection",()=>{
  expect(previewMigrationScope(undefined)).toBe("MOCK");expect(previewMigrationScope("AI_SERVICE")).toBe("AI_SERVICE");expect(()=>previewMigrationScope("PRODUCTION")).toThrow();
 });
});


describe("Preview environment isolation",()=>{
 it("parses only whitelisted file lines with no interpolation or process mutation",()=>{
  const before=process.env.DATABASE_URL;
  const result=parsePreviewLocalEnvironment("DATABASE_URL='postgresql://synthetic.invalid/preview'\nADMIN_PASSWORD=\"synthetic!\"\nAI_MOCK_LIMITS='{\"dailyCost\":0}'\nPRODUCTION_DIRECT_URL='MUST_NOT_COPY'\nOPENAI_API_KEY='MUST_NOT_COPY'\n");
  expect(result).toEqual({DATABASE_URL:"postgresql://synthetic.invalid/preview",ADMIN_PASSWORD:"synthetic!",AI_MOCK_LIMITS:'{"dailyCost":0}'});expect(process.env.DATABASE_URL).toBe(before);
 });
 it.each(["DATABASE_URL=${PRODUCTION_DIRECT_URL}","ADMIN_PASSWORD=\"$PRODUCTION_PASSWORD\"","ADMIN_PASSWORD='first'\nADMIN_PASSWORD='second'","ADMIN_PASSWORD=[SENSITIVE]"])("rejects unsafe source syntax without expanding it: %s",content=>{
  expect(()=>parsePreviewLocalEnvironment(content)).toThrow();
 });
 it("child environments exclude Production/provider/auth secrets and NODE_OPTIONS",()=>{
  const inherited={NODE_ENV:"test" as const,PATH:"synthetic-path",DATABASE_URL:"preview",DIRECT_URL:"preview-direct",PREVIEW_E2E_FOCUS:"AI_SERVICE",AI_MOCK_REQUEST_SECRET:"synthetic-proof",PRODUCTION_DATABASE_URL:"MUST_NOT_COPY",OPENAI_API_KEY:"MUST_NOT_COPY",AUTH_SECRET:"MUST_NOT_COPY",NODE_OPTIONS:"MUST_NOT_COPY"};
  expect(previewChildEnvironment(inherited)).toEqual({NODE_ENV:"test",PATH:"synthetic-path",DATABASE_URL:"preview",DIRECT_URL:"preview-direct",PREVIEW_E2E_FOCUS:"AI_SERVICE",AI_MOCK_REQUEST_SECRET:"synthetic-proof"});
  expect(previewPrismaEnvironment("verified-preview-direct",inherited)).toEqual({NODE_ENV:"test",PATH:"synthetic-path",DATABASE_URL:"verified-preview-direct",DIRECT_URL:"verified-preview-direct"});
 });
 it("reads only the explicitly named local file and refuses absent required sources",()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),"ai-service-policy-"));roots.push(root);writeFileSync(path.join(root,".env"),"DATABASE_URL=UNAPPROVED");
  expect(()=>readPreviewLocalEnvironment(root)).toThrow();expect(readPreviewLocalEnvironment(root,false)).toEqual({});
  writeFileSync(path.join(root,".env.local"),"DATABASE_URL='synthetic-preview'\nPRODUCTION_DATABASE_URL='MUST_NOT_COPY'\n");expect(readPreviewLocalEnvironment(root)).toEqual({DATABASE_URL:"synthetic-preview"});
 });
});


describe("Review: constraint failures must identify the expected PostgreSQL contract",()=>{
 const targets=["APPEND_ONLY","UNIQUE_PIN","CONFIG_ENVIRONMENT"] as const;
 type Target=typeof targets[number];
 const contracts={
  APPEND_ONLY:{code:"P0001",message:"ERROR: AI_SERVICE_FINANCIAL_APPEND_ONLY"},
  UNIQUE_PIN:{code:"23505",message:'ERROR: duplicate key value violates unique constraint "AiServiceKeyPin_environment_version_key"\nDETAIL: synthetic only'},
  CONFIG_ENVIRONMENT:{code:"23514",message:'ERROR: new row for relation "AiServiceConfig" violates check constraint "ai_service_config_environment"\nDETAIL: synthetic only'},
 };
 function rawError(meta:Record<string,unknown>){return new Prisma.PrismaClientKnownRequestError("SYNTHETIC_RAW_ERROR_MUST_NOT_ESCAPE",{code:"P2010",clientVersion:"synthetic",meta});}
 async function integrity(failureTarget?:Target,failure?:(target:Target)=>unknown){
  const fixture=await fakeClient(),original=fixture.tx.$executeRaw.bind(fixture.tx);
  fixture.tx.$executeRaw=(async(parts:TemplateStringsArray,...values:unknown[])=>{
   const query=parts.join(""),target=query.startsWith('UPDATE "AiServiceKeyPin"')?"APPEND_ONLY":query.startsWith('INSERT INTO "AiServiceKeyPin"')?"UNIQUE_PIN":query.startsWith('INSERT INTO "AiServiceConfig"')?"CONFIG_ENVIRONMENT":undefined;
   if(!target)return original(parts,...values);
   if(target===failureTarget){const error=failure?.(target);if(error===undefined)return 1;throw error;}
   throw rawError(contracts[target]);
  }) as typeof fixture.tx.$executeRaw;
  return{...fixture,run:()=>runRollbackValidation(fixture.client,scope,c=>runScenario(c,"INTEGRITY"))};
 }
 it("accepts only the three expected Prisma6 P2010 SQLSTATE/target failures through actual scenario composition",async()=>{
  const f=await integrity(),result=await f.run();expect(result).toMatchObject({rollbackVerified:true,checks:{appendOnlyPinUpdateDenied:true,uniquePinDenied:true,environmentCheckDenied:true}});
  expect(Object.values(f.f.state).every(rows=>rows.length===0)).toBe(true);
 });
 const failures=[
  {name:"generic DB error",error:()=>new Error("SYNTHETIC_SECRET_DB_ERROR")},
  {name:"connection P1001",error:()=>new Prisma.PrismaClientKnownRequestError("SYNTHETIC_SECRET_CONNECTION",{code:"P1001",clientVersion:"synthetic"})},
  {name:"statement timeout",error:(target:Target)=>rawError({...contracts[target],code:"57014"})},
  {name:"lock timeout",error:(target:Target)=>rawError({...contracts[target],code:"55P03"})},
  {name:"wrong SQLSTATE",error:(target:Target)=>rawError({...contracts[target],code:"99999"})},
  {name:"wrong constraint or trigger",error:(target:Target)=>rawError({...contracts[target],message:'ERROR: unrelated failure "wrong_constraint"'})},
  {name:"missing structured metadata",error:()=>rawError({})},
  {name:"untrusted plain error object",error:(target:Target)=>({code:"P2010",meta:contracts[target]})},
  {name:"no exception",error:()=>undefined},
 ];
 for(const target of targets){
  it.each(failures)(target+" rejects $name without a false PASS or raw error",async({error})=>{
   const f=await integrity(target,error),logs=[vi.spyOn(console,"error").mockImplementation(()=>{}),vi.spyOn(console,"warn").mockImplementation(()=>{}),vi.spyOn(console,"log").mockImplementation(()=>{})];
   try{await expect(f.run()).rejects.toThrow(/^AI_SERVICE_VALIDATION_DENIED$/);expect(Object.values(f.f.state).every(rows=>rows.length===0)).toBe(true);for(const log of logs)expect(log).not.toHaveBeenCalled();}
   finally{for(const log of logs)log.mockRestore();}
  });
 }
 it("domain denial assertions reject unrelated fixed-message lookalikes",async()=>{
  const f=await fakeClient(),original=serviceAdmin.saveGuidance,spy=vi.spyOn(serviceAdmin,"saveGuidance").mockImplementation(async(...args)=>{
   if(args[2].role!=="ADMIN")throw new Error("AI_SERVICE_DENIED");return original(...args);
  });
  try{await expect(runRollbackValidation(f.client,scope,c=>runScenario(c,"SECURITY"))).rejects.toThrow(/^AI_SERVICE_VALIDATION_DENIED$/);expect(Object.values(f.f.state).every(rows=>rows.length===0)).toBe(true);}
  finally{spy.mockRestore();}
 });
});
