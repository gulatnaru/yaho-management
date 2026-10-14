import { randomBytes } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";
import { readKeys } from "@/lib/ai-consultations/crypto";
import { readLimits } from "@/server/ai-consultations/ledger";
import { assertDeploymentMatchesRepository, readPreviewE2eConfiguration } from "@/lib/e2e/preview-runner";

import { assertApprovedPreviewUrl } from "@/lib/e2e/preview-safety";

export const PHASE21_RUNNER_ENV_KEYS = ["DATABASE_URL","DIRECT_URL","ADMIN_EMAIL","ADMIN_PASSWORD","VERCEL_AUTOMATION_BYPASS_SECRET","PREVIEW_E2E_HANDSHAKE_SECRET","PREVIEW_E2E_SUPABASE_PROJECT_REF","PRODUCTION_E2E_SUPABASE_PROJECT_REF","PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256","PLAYWRIGHT_BASE_URL","PREVIEW_E2E_ALLOWED_BASE_URLS","PREVIEW_E2E_DEPLOYMENT_SHA"] as const;
export const PHASE21_AI_ENV_KEYS = ["AI_ENCRYPTION_KEYS","AI_ENCRYPTION_ACTIVE","AI_HMAC_KEYS","AI_HMAC_ACTIVE","AI_MOCK_REQUEST_SECRET","AI_MOCK_LIMITS"] as const;
const remoteKeys = ["DATABASE_URL","DIRECT_URL","PREVIEW_E2E_HANDSHAKE_SECRET","PREVIEW_E2E_SUPABASE_PROJECT_REF","PRODUCTION_E2E_SUPABASE_PROJECT_REF","PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256",...PHASE21_AI_ENV_KEYS] as const;
export function assertPhase21ValidationBranch(branch:string) {
  if (!["feature/phase21-preview-validation","feature/phase21-kakao-ai-consultation"].includes(branch)) throw new Error("P21_ENV_BRANCH_DENIED");
}
export function createPhase21MockKeys() {
  const fresh=()=>randomBytes(32).toString("base64");
  return {NODE_ENV:"development" as const,AI_ENCRYPTION_KEYS:JSON.stringify({v1:fresh()}),AI_ENCRYPTION_ACTIVE:"v1",AI_HMAC_KEYS:JSON.stringify({v1:fresh()}),AI_HMAC_ACTIVE:"v1",AI_MOCK_REQUEST_SECRET:fresh(),AI_MOCK_LIMITS:JSON.stringify({subjectPerMinute:30,globalPerMinute:150,dailyCalls:1000,dailyCost:0})};
}
export function serializePhase21Environment(environment:NodeJS.ProcessEnv) {
  return [...PHASE21_RUNNER_ENV_KEYS,...PHASE21_AI_ENV_KEYS].map(key=>{
    const value=environment[key];
    if (!value || value.includes("[SENSITIVE]") || /[\r\n]/.test(value)) throw new Error("P21_ENV_VALUE_DENIED");
    // Single quotes prevent dotenv interpolation; unsupported quoting fails closed.
    if (value.includes("'")) throw new Error("P21_ENV_QUOTING_DENIED");
    return key+"='"+value+"'";
  }).join("\n")+"\n";
}
export function stampPhase21DeploymentContent(content:string,url:string,sha:string) {
  const origin=assertApprovedPreviewUrl(url,url);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("P21_ENV_DEPLOYMENT_DENIED");
  let updated=content;
  for (const [key,value] of [["PLAYWRIGHT_BASE_URL",origin],["PREVIEW_E2E_ALLOWED_BASE_URLS",origin],["PREVIEW_E2E_DEPLOYMENT_SHA",sha]]) {
    const pattern=new RegExp("^"+key+"=.*$","gm");
    if ((updated.match(pattern)??[]).length!==1) throw new Error("P21_ENV_DEPLOYMENT_DENIED");
    updated=updated.replace(pattern,key+"='"+value+"'");
  }
  return updated;
}
function explicitLocal(directory:string) {
  if (!path.isAbsolute(directory) || !existsSync(path.join(directory,".env.local"))) throw new Error("P21_ENV_SOURCE_DENIED");
  // Read parsed file values directly, so inherited shell values never replace this source.
  const loaded=loadEnvConfig(directory,true,{info:()=>{},error:()=>{}},true);
  const local=loaded.loadedEnvFiles.find(file=>file.path===".env.local")?.env;
  if (!local) throw new Error("P21_ENV_SOURCE_DENIED");
  return local;
}
function assertTarget(environment:NodeJS.ProcessEnv) {
  const config=readPreviewE2eConfiguration(environment);
  if (config.previewProjectRef!==process.env.PHASE21_APPROVED_PREVIEW_PROJECT_REF || config.productionProjectRef!==process.env.PHASE21_DENIED_PRODUCTION_PROJECT_REF) throw new Error("P21_ENV_TARGET_DENIED");
  readKeys(environment);readLimits(environment);
}
function cliPath() {
  const cli=process.env.PHASE21_VERCEL_CLI_PATH;
  if (!cli || !path.isAbsolute(cli) || !existsSync(cli)) throw new Error("P21_ENV_CLI_DENIED");
  return cli;
}
async function capturedVercel(args:string[],input?:string) {
  return new Promise<string>((resolve,reject)=>{
    const child=execFile(process.execPath,[cliPath(),...args],{cwd:process.cwd(),timeout:60000,maxBuffer:1024*1024},(error,stdout)=>error?reject(new Error("P21_ENV_VERCEL_FAILED")):resolve(stdout));
    child.stdin?.end(input ?? "");
  });
}
async function main() {
  const stage=process.argv[2];
  if (stage!=="local" && stage!=="remote" && stage!=="deployment") throw new Error("P21_ENV_STAGE_DENIED");
  const source=process.env.PHASE21_ENV_SOURCE_DIR;
  if (!source || path.resolve(source)===process.cwd()) throw new Error("P21_ENV_SOURCE_DENIED");
  const approvedSource=explicitLocal(source);
  const localPath=path.resolve(".env.local");
  const existing=existsSync(localPath);
  const current=existing?explicitLocal(process.cwd()):{};
  const desired:NodeJS.ProcessEnv={NODE_ENV:"development",...Object.fromEntries(PHASE21_RUNNER_ENV_KEYS.map(key=>[key,approvedSource[key]]))};
  if (existing) {
    for (const key of PHASE21_RUNNER_ENV_KEYS) {
      if (!["PLAYWRIGHT_BASE_URL","PREVIEW_E2E_ALLOWED_BASE_URLS","PREVIEW_E2E_DEPLOYMENT_SHA"].includes(key) && current[key]!==desired[key]) throw new Error("P21_ENV_EXISTING_MISMATCH");
      desired[key]=current[key];
    }
    for (const key of PHASE21_AI_ENV_KEYS) desired[key]=current[key];
  } else {
    const keySource=process.env.PHASE21_MOCK_KEYS_SOURCE_DIR;
    if (keySource) {
      const previous=explicitLocal(keySource);
      for (const key of PHASE21_AI_ENV_KEYS) desired[key]=previous[key];
    } else Object.assign(desired,createPhase21MockKeys());
  }
  assertTarget(desired);
  if (stage==="deployment") {
    if (!existing) throw new Error("P21_ENV_EXISTING_REQUIRED");
    const url=process.env.PHASE21_VALIDATION_DEPLOYMENT_URL ?? "",sha=process.env.PHASE21_VALIDATION_DEPLOYMENT_SHA ?? "";
    assertDeploymentMatchesRepository({deploymentSha:sha});
    assertPhase21ValidationBranch(execFileSync("git",["branch","--show-current"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim());
    const content=readFileSync(localPath,"utf8");
    const updated=stampPhase21DeploymentContent(content,url,sha);
    writeFileSync(localPath,updated,{mode:0o600});
    console.log(JSON.stringify({stage,result:"PASS",updatedKeys:3,allOtherValuesPreserved:true}));
    return;
  }
  if (stage==="local") {
    // Refuse a repository lacking ignore protection before creating secret material.
    try {execFileSync("git",["check-ignore","--no-index",".env.local"],{stdio:"pipe"});} catch {throw new Error("P21_ENV_NOT_IGNORED");}
    if (!existing) writeFileSync(localPath,serializePhase21Environment(desired),{flag:"wx",mode:0o600});
    console.log(JSON.stringify({stage,result:"PASS",created:!existing,runnerKeys:PHASE21_RUNNER_ENV_KEYS.length,mockKeys:PHASE21_AI_ENV_KEYS.length}));
    return;
  }
  if (!existing || process.env.PHASE21_PREVIEW_ENV_APPROVED!=="1") throw new Error("P21_ENV_APPROVAL_REQUIRED");
  const branch=process.argv[3] ?? "";assertPhase21ValidationBranch(branch);
  const project=process.env.PHASE21_VERCEL_PROJECT_ID,team=process.env.PHASE21_VERCEL_TEAM_ID,scope=process.env.PHASE21_VERCEL_SCOPE;
  if (!project || !/^prj_[A-Za-z0-9]+$/.test(project) || !team || !/^team_[A-Za-z0-9]+$/.test(team) || !scope) throw new Error("P21_ENV_PROJECT_DENIED");
  const metadata=JSON.parse(await capturedVercel(["api","/v9/projects/"+project+"?teamId="+team,"--scope",scope])) as {id?:string;accountId?:string};
  if (metadata.id!==project || metadata.accountId!==team) throw new Error("P21_ENV_PROJECT_MISMATCH");
  for (const key of remoteKeys) await capturedVercel(["env","add",key,"preview","--git-branch",branch,"--project",project,"--scope",scope,"--sensitive","--force"],desired[key]);
  console.log(JSON.stringify({stage,result:"PASS",target:"preview",branch,configured:remoteKeys.length}));
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch((error:unknown)=>{
  const code=error instanceof Error && /^P21_ENV_[A-Z_]+$/.test(error.message)?error.message:"P21_ENV_FAILED";
  console.error(JSON.stringify({result:"FAIL",code}));process.exitCode=1;
});
