/** Explicit opt-in. Never reads .env or accepts a remote datasource. Stop the owned disposable cluster after use. */
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {PrismaClient} from "@prisma/client";
import {claim,markDispatched,settle,reconcileMonth} from "../../server/ai-service/ledger";
import {saveConfig,savePublication} from "../../server/ai-service/admin";
import {transaction} from "../../server/ai-service/repository";
import {purgeExpired} from "../../server/ai-service/retention";
import {monthKst} from "../../server/ai-service/cost";
import {ServiceDenied,RETENTION_MS} from "../../server/ai-service/contracts";

async function main(){
 assert.equal(process.env.AI_SERVICE_LOCAL_POSTGRES_APPROVED,"1");
 const url="postgresql://postgres@127.0.0.1:55421/yaho_phase21_validation?connection_limit=8";
 const a=new PrismaClient({datasourceUrl:url,log:[]}),b=new PrismaClient({datasourceUrl:url,log:[]});
 process.env.DATABASE_URL=url;process.env.DIRECT_URL=url;
 const retry=async<T>(fn:()=>Promise<T>):Promise<T>=>{for(let i=0;;i++){try{return await fn();}catch(e){if(!(e instanceof ServiceDenied)||i>=4)throw e;await new Promise(r=>setTimeout(r,30));}}};
 const run=randomUUID(),actor={userId:"synthetic-local-"+run,role:"ADMIN",active:true};
 const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
 const pin={version:"v1",fingerprint:digest("local-synthetic-key")};
 let now=new Date("2030-01-05T00:00:00Z"),passed=0;
 const input=(id:string,subject=id)=>({environment:"PREVIEW" as const,now,hmacPins:[pin],requestHashes:["v1:"+digest(run+id)],payloadHashes:["v1:"+digest("synthetic")],subjectHashes:["v1:"+digest(run+subject)]});
 const check=async(name:string,fn:()=>Promise<void>)=>{await fn();passed++;console.log(JSON.stringify({check:name,result:"PASS"}));};
 const claimed=async(id:string)=>{const c=await retry(()=>claim(a,input(id)));assert.equal(c.kind,"CLAIMED");if(c.kind!=="CLAIMED")throw Error("CLAIM_FAILED");return c.row;};
 const fail=async(fn:()=>Promise<unknown>)=>{await assert.rejects(fn,e=>e instanceof ServiceDenied&&e.message==="AI_SERVICE_DENIED");};
 const config=async()=>{const old=await a.aiServiceConfig.findUnique({where:{environment:"PREVIEW"}});await saveConfig(a,"PREVIEW",actor,{expectedVersion:old?.version??0,paused:false,provider:"TEST_DOUBLE",model:"gpt-6-luna",priceVersion:"synthetic-local",inputNanoUsdPerToken:100,outputNanoUsdPerToken:500,fxMilliKrwPerUsd:1400000,fxCheckedAt:now,fxSource:"synthetic-only"},now);};
 try{
 const identity=await a.$queryRaw<{database:string;address:string}[]>`SELECT current_database() AS database,inet_server_addr()::text AS address`;
 assert.equal(identity[0].database,"yaho_phase21_validation");
 assert.equal(await a.aiServiceRequest.count(),0);assert.equal(await a.aiServiceBudgetMonth.count(),0);
 const pids=await Promise.all([a.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`,b.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`]);assert.notEqual(pids[0][0].pid,pids[1][0].pid);
 await Promise.all([a.aiServiceRequest.findMany(),b.aiServiceRequest.findMany(),a.aiServiceBudgetMonth.findMany(),b.aiServiceQuotaBucket.findMany(),a.aiServiceKeyPin.findMany(),b.aiServiceConfig.findMany()]);
 await config();
 await check("independent duplicate claim commits once",async()=>{
 const first=await Promise.allSettled([claim(a,input("same")),claim(b,input("same"))]);
 for(const o of first)if(o.status==="rejected")assert.ok(o.reason instanceof ServiceDenied);
 const result=await Promise.all([retry(()=>claim(a,input("same"))),retry(()=>claim(b,input("same")))]);
 assert.ok(result.every(r=>r.kind==="DUPLICATE")||result.map(r=>r.kind).sort().join(",")==="CLAIMED,DUPLICATE");
 assert.equal(await a.aiServiceRequest.count(),1);
 const row=await a.aiServiceRequest.findFirstOrThrow();await settle(a,"PREVIEW",row.id,row.attempt,{kind:"UNDISPATCHED"},now);
 });
 await check("independent settlement charges and metric once",async()=>{
 const row=await claimed("settle");await markDispatched(a,"PREVIEW",row.id,row.attempt,now);
 const result=await Promise.all([retry(()=>settle(a,"PREVIEW",row.id,row.attempt,{kind:"KNOWN",inputTokens:100,outputTokens:10,category:"GUIDANCE"},now)),retry(()=>settle(b,"PREVIEW",row.id,row.attempt,{kind:"KNOWN",inputTokens:100,outputTokens:10,category:"GUIDANCE"},now))]);
 assert.deepEqual(result.sort(),[false,true]);assert.equal((await a.aiServiceDailyMetric.findFirstOrThrow()).modelCalls,1);
 assert.equal((await a.aiServiceBudgetMonth.findFirstOrThrow()).reservedKrw,0);
 });
 await check("same invoice reconciliation commits once",async()=>{
 const budget=await a.aiServiceBudgetMonth.findFirstOrThrow();const evidence={month:monthKst(now),expectedVersion:budget.version,billedKrw:998,heldActualKrw:0,resolveAllHeld:true,reference:"invoice-"+run,coveredThroughGeneration:budget.dispatchGeneration,coverageConfirmed:true as const};
 const result=await Promise.all([retry(()=>reconcileMonth(a,"PREVIEW",actor,evidence,now)),retry(()=>reconcileMonth(b,"PREVIEW",actor,evidence,now))]);
 assert.deepEqual(result.map(r=>r.kind).sort(),["APPLIED","REPLAY"]);assert.equal(await a.aiServiceReconciliation.count(),1);
 });
 await check("last monthly budget admission cannot overspend",async()=>{
 const outcomes=await Promise.allSettled([claim(a,input("last-A")),claim(b,input("last-B"))]);
 assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);
 for(const o of outcomes){if(o.status==="rejected")assert.ok(o.reason instanceof ServiceDenied);else {assert.equal(o.value.kind,"CLAIMED");if(o.value.kind==="CLAIMED")await settle(a,"PREVIEW",o.value.row.id,o.value.row.attempt,{kind:"UNDISPATCHED"},now);}}
 const budget=await a.aiServiceBudgetMonth.findFirstOrThrow();assert.ok(budget.usedKrw+budget.correctionKrw+budget.reservedKrw<=1000);
 });
 now=new Date("2030-02-05T00:00:00Z");await config();
 await check("subject quota final acceptance commits once",async()=>{
 for(let i=0;i<9;i++){const c=await claim(a,input("quota-"+i,"shared"));assert.equal(c.kind,"CLAIMED");if(c.kind==="CLAIMED")await settle(a,"PREVIEW",c.row.id,c.row.attempt,{kind:"UNDISPATCHED"},now);}
 const outcomes=await Promise.allSettled([claim(a,input("quota-A","shared")),claim(b,input("quota-B","shared"))]);
 assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);
 for(const o of outcomes){if(o.status==="rejected")assert.ok(o.reason instanceof ServiceDenied);else if(o.value.kind==="CLAIMED")await settle(a,"PREVIEW",o.value.row.id,o.value.row.attempt,{kind:"UNDISPATCHED"},now);else assert.fail("unexpected duplicate");}
 const bucket=await a.aiServiceQuotaBucket.findFirstOrThrow({where:{kind:"SUBJECT_HOUR",window:now.toISOString().slice(0,13)}});assert.equal(bucket.accepted,10);
 });
 await check("publication version conflict and withdrawal",async()=>{
 const id="synthetic-local-"+run;await a.program.create({data:{id,name:"합성 숲체험",status:"ACTIVE",updatedAt:now}});
 await savePublication(a,"PREVIEW",actor,{kind:"PROGRAM",id,enabled:true,expectedVersion:0});
 const outcomes=await Promise.allSettled([savePublication(a,"PREVIEW",actor,{kind:"PROGRAM",id,enabled:false,expectedVersion:1}),savePublication(b,"PREVIEW",actor,{kind:"PROGRAM",id,enabled:false,expectedVersion:1})]);
 assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);for(const o of outcomes)if(o.status==="rejected")assert.ok(o.reason instanceof ServiceDenied);
 assert.equal((await a.aiServiceProgramPublication.findFirstOrThrow({where:{programId:id}})).enabled,false);
 });
 await check("lock timeout rejects and transaction rollback is atomic",async()=>{
 let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});let entered!:()=>void;const locked=new Promise<void>(r=>{entered=r;});
 const holder=a.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('ai-service:PREVIEW',21062))`;entered();await barrier;},{timeout:3000});
 await locked;try{await fail(()=>claim(b,input("locked")));}finally{release();await holder;}
 assert.equal(await a.aiServiceRequest.count({where:{requestKey:input("locked").requestHashes[0]}}),0);
 const before=await a.aiServiceConfig.findUniqueOrThrow({where:{environment:"PREVIEW"}});
 await fail(()=>transaction(a,"PREVIEW",async tx=>{await tx.aiServiceConfig.update({where:{environment:"PREVIEW"},data:{paused:true}});throw Error("SYNTHETIC_ROLLBACK");}));
 assert.equal((await a.aiServiceConfig.findUniqueOrThrow({where:{environment:"PREVIEW"}})).paused,before.paused);
 });
 await check("pool maxWait rejects without executing writer",async()=>{
 const single=new PrismaClient({datasourceUrl:"postgresql://postgres@127.0.0.1:55421/yaho_phase21_validation?connection_limit=1",log:[]});
 let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});let entered!:()=>void;const locked=new Promise<void>(r=>{entered=r;});
 const holder=single.$transaction(async tx=>{await tx.$queryRaw`SELECT 1`;entered();await barrier;},{timeout:3000});
 try{await locked;let executed=false;await fail(()=>transaction(single,"PREVIEW",async()=>{executed=true;}));assert.equal(executed,false);}finally{release();await holder;await single.$disconnect();}
 });
 await check("expiry purge versus late settlement preserves finance",async()=>{
 const row=await claimed("expired");await markDispatched(a,"PREVIEW",row.id,row.attempt,now);const expiry=new Date(+now+RETENTION_MS);
 const outcomes=await Promise.allSettled([purgeExpired(a,"PREVIEW",expiry),settle(b,"PREVIEW",row.id,row.attempt,{kind:"KNOWN",inputTokens:100,outputTokens:10,category:"GUIDANCE"},expiry)]);
 assert.ok(outcomes.every(o=>o.status==="fulfilled"));assert.equal(await a.aiServiceRequest.count({where:{id:row.id}}),0);
 const budget=await a.aiServiceBudgetMonth.findUniqueOrThrow({where:{environment_month:{environment:"PREVIEW",month:monthKst(now)}}});
 assert.ok((budget.reservedKrw===2&&budget.usedKrw===0&&budget.unknownCount===1)||(budget.reservedKrw===0&&budget.usedKrw===1&&budget.unknownCount===0));assert.equal(await a.aiServiceKeyPin.count(),1);assert.equal(await a.aiServiceReconciliation.count(),1);
 });
 console.log(JSON.stringify({result:"PASS",checks:passed,independentClients:2,externalCalls:0,cleanup:"stop owned disposable cluster; append-only records retained"}));
 }finally{await Promise.all([a.$disconnect(),b.$disconnect()]);}
}
main().catch((error:unknown)=>{console.error(JSON.stringify({result:"FAIL",name:error instanceof Error?error.name:"unknown",code:typeof error==="object"&&error!==null&&"code" in error?error.code:null,message:error instanceof Error&&error.name==="AssertionError"?"assertion failed":error instanceof ServiceDenied?"AI_SERVICE_DENIED":"unknown"}));process.exitCode=1;});
