import {existsSync,readFileSync} from "node:fs";
import path from "node:path";
export const PREVIEW_RUNNER_ENV_KEYS=["DATABASE_URL","DIRECT_URL","ADMIN_EMAIL","ADMIN_PASSWORD","VERCEL_AUTOMATION_BYPASS_SECRET","PREVIEW_E2E_HANDSHAKE_SECRET","PREVIEW_E2E_SUPABASE_PROJECT_REF","PRODUCTION_E2E_SUPABASE_PROJECT_REF","PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256","PLAYWRIGHT_BASE_URL","PREVIEW_E2E_ALLOWED_BASE_URLS","PREVIEW_E2E_DEPLOYMENT_SHA"] as const;
export const PREVIEW_MOCK_ENV_KEYS=["AI_ENCRYPTION_KEYS","AI_ENCRYPTION_ACTIVE","AI_HMAC_KEYS","AI_HMAC_ACTIVE","AI_MOCK_REQUEST_SECRET","AI_MOCK_LIMITS"] as const;
const executionKeys=[...PREVIEW_RUNNER_ENV_KEYS,...PREVIEW_MOCK_ENV_KEYS,"PREVIEW_E2E_FOCUS","PLAYWRIGHT_PREVIEW_E2E","PLAYWRIGHT_NO_COPY_PROMPT","YAHO_E2E_RUN_ID","PREVIEW_E2E_RUNNER_PROOF_PATH","PREVIEW_E2E_RUNNER_PROOF","PREVIEW_E2E_PHASE20_SIGNED_RUN"] as const;
const systemKeys=["PATH","Path","PATHEXT","SystemRoot","SYSTEMROOT","WINDIR","ComSpec","COMSPEC","TEMP","TMP","TMPDIR","HOME","USERPROFILE","APPDATA","LOCALAPPDATA","NODE_ENV","CI","FORCE_COLOR","NO_COLOR","PLAYWRIGHT_BROWSERS_PATH"] as const;
function pick(environment:NodeJS.ProcessEnv,keys:readonly string[]){return Object.fromEntries(keys.filter(key=>environment[key]!==undefined).map(key=>[key,environment[key]])) as NodeJS.ProcessEnv;}
/** No provider keys, Production credentials, NODE_OPTIONS or unrelated inherited variables. */
export function previewChildEnvironment(environment:NodeJS.ProcessEnv){return{...pick(environment,systemKeys),...pick(environment,executionKeys)};}
export function previewPrismaEnvironment(directUrl:string,environment:NodeJS.ProcessEnv){return{...pick(environment,systemKeys),DATABASE_URL:directUrl,DIRECT_URL:directUrl};}
/** Read only approved .env.local lines. No interpolation, evaluation or process.env mutation.
 * Strict supported quoting fails closed instead of importing other source variables.
 */
export function parsePreviewLocalEnvironment(content:string){
 const allowed=new Set<string>([...PREVIEW_RUNNER_ENV_KEYS,...PREVIEW_MOCK_ENV_KEYS]),selected={} as NodeJS.ProcessEnv;
 for(const line of content.split(/\r?\n/)){
  const match=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);if(!match||!allowed.has(match[1]))continue;
  const [,key,raw]=match;if(Object.hasOwn(selected,key))throw new Error("PREVIEW_ENV_DUPLICATE_DENIED");
  let value=raw.trim();
  if(value.startsWith("'")){const quoted=value.match(/^'([^']*)'\s*(?:#.*)?$/);if(!quoted)throw new Error("PREVIEW_ENV_QUOTING_DENIED");value=quoted[1];}
  else if(value.startsWith('"')){const quoted=value.match(/^"([^"\\]*)"\s*(?:#.*)?$/);if(!quoted||/\$(?:\{|[A-Za-z_])/.test(quoted[1]))throw new Error("PREVIEW_ENV_INTERPOLATION_DENIED");value=quoted[1];}
  else{value=value.replace(/\s+#.*$/,"").trim();if(/[\s'"\\]/.test(value)||/\$(?:\{|[A-Za-z_])/.test(value))throw new Error("PREVIEW_ENV_QUOTING_DENIED");}
  if(!value||value.includes("[SENSITIVE]"))throw new Error("PREVIEW_ENV_VALUE_DENIED");selected[key]=value;
 }
 return selected;
}
export function readPreviewLocalEnvironment(directory:string,required=true):NodeJS.ProcessEnv{
 if(!path.isAbsolute(directory))throw new Error("PREVIEW_ENV_SOURCE_DENIED");
 const local=path.join(directory,".env.local");if(!existsSync(local)){if(required)throw new Error("PREVIEW_ENV_SOURCE_DENIED");return{} as NodeJS.ProcessEnv;}
 return parsePreviewLocalEnvironment(readFileSync(local,"utf8"));
}
export function previewExecutionEnvironment(directory:string,inherited:NodeJS.ProcessEnv){return previewChildEnvironment({...readPreviewLocalEnvironment(directory,false),...pick(inherited,[...systemKeys,...executionKeys])});}
