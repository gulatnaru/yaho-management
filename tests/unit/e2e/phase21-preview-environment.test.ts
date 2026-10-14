import { describe,expect,it } from "vitest";
import { stampPhase21DeploymentContent,assertPhase21ValidationBranch,createPhase21MockKeys,serializePhase21Environment,PHASE21_RUNNER_ENV_KEYS,PHASE21_AI_ENV_KEYS } from "@/scripts/e2e/phase21-preview-environment";
import { readKeys } from "@/lib/ai-consultations/crypto";
import { readLimits } from "@/server/ai-consultations/ledger";
describe("Phase21 isolated Preview secret provisioning",()=>{
  it("stamps only the three approved deployment fields and refuses Production/duplicates",()=>{
    const before="PLAYWRIGHT_BASE_URL='https://old.vercel.app'\nPREVIEW_E2E_ALLOWED_BASE_URLS='https://old.vercel.app'\nPREVIEW_E2E_DEPLOYMENT_SHA='"+"a".repeat(40)+"'\nAI_MOCK_REQUEST_SECRET='UNCHANGED'\nADMIN_PASSWORD='UNCHANGED'\n";
    const result=stampPhase21DeploymentContent(before,"https://candidate.vercel.app","b".repeat(40));
    expect(result).toContain("AI_MOCK_REQUEST_SECRET='UNCHANGED'\nADMIN_PASSWORD='UNCHANGED'");
    expect(result).not.toContain("old.vercel.app");
    expect(()=>stampPhase21DeploymentContent(before,"https://yaho-management.vercel.app","b".repeat(40))).toThrow();
    expect(()=>stampPhase21DeploymentContent(before+"PLAYWRIGHT_BASE_URL=x\n","https://candidate.vercel.app","b".repeat(40))).toThrow();
  });
  it("produces three independent256bit versioned keys and zero actual cost limits",()=>{
    const environment=createPhase21MockKeys(),ring=readKeys(environment);
    expect(ring.encryption.v1.length).toBe(32);expect(ring.hmac.v1.length).toBe(32);expect(ring.auth.length).toBe(32);
    expect(new Set([ring.encryption.v1,ring.hmac.v1,ring.auth].map(value=>value.toString("hex"))).size).toBe(3);
    expect(readLimits(environment)).toMatchObject({dailyCost:0,subjectPerMinute:30});
    expect(createPhase21MockKeys().AI_MOCK_REQUEST_SECRET).not.toBe(environment.AI_MOCK_REQUEST_SECRET);
  });
  it("serializes only approved names, never inherited Production/provider secrets",()=>{
    const environment:NodeJS.ProcessEnv={...Object.fromEntries(PHASE21_RUNNER_ENV_KEYS.map(key=>[key,"synthetic-value"])),...createPhase21MockKeys(),PRODUCTION_DIRECT_URL:"MUST_NOT_COPY",OPENAI_API_KEY:"MUST_NOT_COPY",KAKAO_SECRET:"MUST_NOT_COPY"};
    const serialized=serializePhase21Environment(environment);
    expect(serialized.split("\n").filter(Boolean)).toHaveLength(PHASE21_RUNNER_ENV_KEYS.length+PHASE21_AI_ENV_KEYS.length);
    expect(serialized).not.toContain("MUST_NOT_COPY");
    for (const invalid of [undefined,"[SENSITIVE]","multiline\nsecret","quote'value"]) expect(()=>serializePhase21Environment({...environment,ADMIN_PASSWORD:invalid})).toThrow();
  });
  it("allows only two specified feature Preview branches and refuses production/main/arbitrary",()=>{
    for(const branch of ["feature/phase21-preview-validation","feature/phase21-kakao-ai-consultation"])expect(()=>assertPhase21ValidationBranch(branch)).not.toThrow();
    for(const branch of ["main","production","feature/unrelated",""])expect(()=>assertPhase21ValidationBranch(branch)).toThrow();
  });
});
