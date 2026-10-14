import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { AI_PROOF_HEADER } from "@/server/ai-consultations/runtime";
import { HUMAN_HANDOFF, SYNTHETIC_GUIDANCE, type Scenario } from "@/lib/ai-consultations/contracts";
import { SYNTHETIC_FACTS } from "@/server/ai-consultations/tools";
import { phase21Fixture, syntheticSkill, skillProof } from "./support/phase21-fixtures";
import { verifyPhase21Postgres } from "../integration/phase21-postgres";

type Fixture=Awaited<ReturnType<typeof phase21Fixture>>;
function assertPublicReply(result:unknown,f:Fixture) {
  const text=JSON.stringify(result);
  expect(text).not.toMatch(/capacity|remainingSeats|reservationCount|rawCiphertext|subjectHashes/);
  for (const id of [...f.scope.manifest.programIds,...f.scope.manifest.classIds,...f.scope.manifest.subjectIds]) expect(text.includes(id)).toBe(false);
  return text;
}
async function send(request:APIRequestContext,f:Fixture,scenario:Scenario="PROGRAMS",requestId=randomUUID()) {
  const body=JSON.stringify(syntheticSkill(f.scope,scenario,requestId));
  const response=await request.post("/api/ai-consultations/mock-skill",{data:body,headers:{"content-type":"application/json",[AI_PROOF_HEADER]:skillProof(f,body)}});
  expect(response.status()).toBe(200);
  const result=await response.json();expect(result.version).toBe("2.0");
  const text=assertPublicReply(result,f);
  return {body,text,requestId};
}

test("Phase21 PostgreSQL duplicate/quota/settlement/expiry/fencing invariants",async()=>{
  test.setTimeout(180000);
  const f=await phase21Fixture();
  try {await verifyPhase21Postgres(f.db,f.scope,f.keys);} finally {await f.cleanup();}
});

test("Phase21 guarded synthetic HTTP facts, revocation, idempotency and privacy",async({request})=>{
  test.setTimeout(180000);
  const f=await phase21Fixture();
  try {
    const programs=await send(request,f);expect(programs.text).toContain(SYNTHETIC_FACTS.name);
    const counts=await f.db.aiConsultation.count({where:{runId:f.scope.runId}});
    const replay=await send(request,f,"PROGRAMS",programs.requestId);expect(replay.text).toBe(programs.text);
    expect(await f.db.aiConsultation.count({where:{runId:f.scope.runId}})).toBe(counts);
    expect((await send(request,f,"CLASSES")).text).toContain(SYNTHETIC_FACTS.location);
    expect((await send(request,f,"AVAILABILITY")).text).toContain("현재 예약 가능한 일정");
    for (const scenario of ["PREPARATION","OUT_OF_SCOPE","INJECTION"] as const) expect((await send(request,f,scenario)).text).toContain(HUMAN_HANDOFF);
    await f.db.aiKnowledgeEntry.create({data:{runId:f.scope.runId,topic:"PREPARATION",content:SYNTHETIC_GUIDANCE.PREPARATION,approved:true,updatedById:"synthetic-runner"}});
    expect((await send(request,f,"PREPARATION")).text).toContain(SYNTHETIC_GUIDANCE.PREPARATION);
    await f.db.aiProgramPublication.updateMany({where:{runId:f.scope.runId,programId:f.scope.manifest.programIds[0]},data:{enabled:false,version:{increment:1}}});
    expect((await send(request,f,"PROGRAMS",programs.requestId)).text).toContain(HUMAN_HANDOFF);
    expect((await send(request,f,"CLASSES")).text).toContain(HUMAN_HANDOFF);
    expect((await send(request,f,"AVAILABILITY")).text).toContain(HUMAN_HANDOFF);
    const beforeDenied=await f.db.aiConsultation.count({where:{runId:f.scope.runId}});
    const denied=await request.post("/api/ai-consultations/mock-skill",{data:programs.body,headers:{"content-type":"application/json",[AI_PROOF_HEADER]:"forged-synthetic-flag"}});
    expect(denied.status()).toBe(403);
    const changed=JSON.stringify(syntheticSkill(f.scope,"CLASSES",programs.requestId));
    const changedResponse=await request.post("/api/ai-consultations/mock-skill",{data:changed,headers:{"content-type":"application/json",[AI_PROOF_HEADER]:skillProof(f,changed)}});
    expect(changedResponse.status()).toBe(403);
    expect(await f.db.aiConsultation.count({where:{runId:f.scope.runId}})).toBe(beforeDenied);
    const real=await request.post("/api/kakao/skill",{data:programs.body});expect(real.status()).toBe(503);
    const cron=await request.get("/api/cron/ai-consultations-retention");expect(cron.status()).toBe(503);
  } finally {await f.cleanup();}
});

test("Phase21 ADMIN owned synthetic mobile controls preserve proof confidentiality",async({page,context})=>{
  test.setTimeout(180000);
  const f=await phase21Fixture();
  try {
    const email=process.env.ADMIN_EMAIL,password=process.env.ADMIN_PASSWORD;
    if (!email || !password) throw new Error("AI_PREVIEW_ADMIN_REQUIRED");
    await page.goto("/ai-consultations");await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("이메일").fill(email);await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button",{name:"로그인",exact:true}).click();await expect(page).toHaveURL(/\/dashboard/);
    await page.setViewportSize({width:390,height:844});
    const proof=skillProof(f,"","AI_ADMIN");
    await context.setExtraHTTPHeaders({"x-vercel-protection-bypass":process.env.VERCEL_AUTOMATION_BYPASS_SECRET!,"x-yaho-phase20-preview-run":process.env.PREVIEW_E2E_PHASE20_SIGNED_RUN!,[AI_PROOF_HEADER]:proof});
    await page.goto("/ai-consultations");await expect(page.getByRole("heading",{name:"AI 상담 — 합성 데이터 검증"})).toBeVisible();
    const html=await page.content();expect(html.includes(proof)).toBe(false);expect(html.includes(process.env.AI_MOCK_REQUEST_SECRET!)).toBe(false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    const program=page.locator('form:has(input[name="kind"][value="PROGRAM"])');
    await program.getByRole("button",{name:"공개 해제",exact:true}).click();await expect(program.getByRole("button",{name:"AI 공개 허용",exact:true})).toBeVisible();
    const publication=await f.db.aiProgramPublication.findUnique({where:{runId_programId:{runId:f.scope.runId,programId:f.scope.manifest.programIds[0]}}});expect(publication?.enabled).toBe(false);
    await program.getByRole("button",{name:"AI 공개 허용",exact:true}).click();await expect(program.getByRole("button",{name:"공개 해제",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"만료 합성 상담 삭제 재시도",exact:true}).click();
    await expect(page.getByText(/상태: SUCCEEDED/)).toBeVisible();
  } finally {await f.cleanup();}
});
