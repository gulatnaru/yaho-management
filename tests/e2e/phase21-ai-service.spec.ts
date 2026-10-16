import {test,expect} from "@playwright/test";
import {phase21Fixture,skillProof} from "./support/phase21-fixtures";
import {AI_PROOF_HEADER} from "@/server/ai-consultations/runtime";
import {VALIDATION_PURPOSE,countServiceRows} from "@/server/ai-service/preview/rollback";
import {type Tx} from "@/server/ai-service/repository";
test.describe("AI_SERVICE rollback-only Preview validation",()=>{
 test.skip(process.env.PLAYWRIGHT_PREVIEW_E2E!=="1","Guarded Preview runner is required");
 test("A. Production/live entry points stay disabled and invalid proof cannot start validation",async({request})=>{
  for(const path of ["/api/ai-service/v1/skill","/api/ai-service/v1/retention"]){
   const response=path.endsWith("skill")?await request.post(path,{data:{synthetic:true}}):await request.get(path);
   expect(response.status()).toBe(503);expect(response.headers()["cache-control"]).toBe("no-store");
  }
  const response=await request.post("/api/e2e/ai-service-validation",{data:{scenario:"FLOW"}});
  expect(response.status()).toBe(403);expect(await response.json()).toEqual({ok:false,error:"AI_SERVICE_VALIDATION_DENIED"});
 });
 test("C. mobile anonymous admin HTML remains access controlled",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto("/ai-service");
  expect(new URL(page.url()).pathname).toBe("/login");
  const html=await page.content();expect(html).not.toMatch(/rawCiphertext|requestHashes|subjectHashes|ai-service:PREVIEW/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 });
 for(const scenario of ["FLOW","PUBLICATION","SECURITY","RETENTION","BUDGET","INTEGRITY","LOCKS"]){
  test("B. "+scenario+" uses real Preview Prisma and always rolls back",async({request})=>{
   test.setTimeout(120000);const f=await phase21Fixture();
   try{
    expect(await countServiceRows(f.db as unknown as Tx)).toBe(0);
    const body=JSON.stringify({scenario});
    const response=await request.post("/api/e2e/ai-service-validation",{data:body,headers:{"content-type":"application/json",[AI_PROOF_HEADER]:skillProof(f,body,VALIDATION_PURPOSE)}});
    expect(response.status()).toBe(200);
    const report=await response.json();
    expect(report).toMatchObject({scenario,externalProviderCalls:0,rollbackVerified:true});
    expect(Object.keys(report.checks).length).toBeGreaterThan(0);
    expect(Object.values(report.checks).every(value=>value===true)).toBe(true);
    expect(await countServiceRows(f.db as unknown as Tx)).toBe(0);
    expect(JSON.stringify(report)).not.toMatch(/rawCiphertext|requestHashes|subjectHashes|password|capacity|reservations/);
   }finally{await f.cleanup();}
  });
 }
});
