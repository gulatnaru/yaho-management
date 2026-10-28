import os from "node:os";
import path from "node:path";
import {mkdtempSync,writeFileSync,mkdirSync,readdirSync,rmSync,existsSync} from "node:fs";
import {spawnSync} from "node:child_process";
import assert from "node:assert/strict";
import {previewArtifactPolicy,PREVIEW_NO_COPY_PROMPT} from "@/lib/e2e/preview-artifact-policy";
import {playwrightCliPath} from "@/lib/e2e/preview-runner";
function verify(mode:"test-failure"|"reporter-exception"){
  const root=mkdtempSync(path.join(os.tmpdir(),"yaho-artifact-privacy-"));
  try{
   const policy=previewArtifactPolicy(path.join(root,"runner-proof")),tests=path.join(root,"cases");mkdirSync(tests);
   const modulePath=require.resolve("@playwright/test"),marker=path.join(root,"browser-executed");
   const reporter=path.join(root,"reporter.cjs");
   writeFileSync(reporter,`module.exports=class{onEnd(){throw new Error("SYNTHETIC_REPORTER_FAILURE");}}`);
   writeFileSync(path.join(root,"playwright.config.cjs"),"module.exports="+JSON.stringify({testDir:tests,...policy,reporter:mode==="reporter-exception"?[[reporter]]:"dot",use:{trace:"off",screenshot:"off"}}));
   writeFileSync(path.join(tests,"synthetic.spec.cjs"),`const {test,expect}=require(${JSON.stringify(modulePath)});test('synthetic artifact denial',async({page})=>{await page.setContent('<p>SYNTHETIC_PRIVATE_BODY</p>');require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');${mode==='test-failure'?"await expect(page.getByText('deliberately absent')).toBeVisible({timeout:10});":""}});`);
   const result=spawnSync(process.execPath,[playwrightCliPath(),"test","--config",path.join(root,"playwright.config.cjs")],{env:{...process.env,PLAYWRIGHT_NO_COPY_PROMPT:PREVIEW_NO_COPY_PROMPT},encoding:"utf8",timeout:25000,maxBuffer:1024*1024});
   assert.equal(existsSync(marker),true,"CONTROLLED_BROWSER_NOT_EXECUTED");
   assert.equal(result.status,1,"CONTROLLED_FAILURE_EXIT_MISMATCH");
   const files=(directory:string):string[]=>{try{return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[entry.name]);}catch{return[];}};
   assert.deepEqual(files(policy.outputDir).filter(name=>/error-context\.md$|\.png$|\.zip$/.test(name)),[],"RAW_ARTIFACT_RETAINED");
  }finally{
   const resolved=path.resolve(root),temp=path.resolve(os.tmpdir());
   if(!resolved.startsWith(temp+path.sep)||!path.basename(resolved).startsWith("yaho-artifact-privacy-"))throw new Error("ARTIFACT_TEMP_PATH_DENIED");
   rmSync(resolved,{recursive:true,force:true});
  }
}
try{for(const mode of ["test-failure","reporter-exception"] as const)verify(mode);console.log(JSON.stringify({check:"manual-synthetic-artifact-privacy",cases:2,passed:2,rawArtifactsRetained:0}));}catch{console.log(JSON.stringify({check:"manual-synthetic-artifact-privacy",result:"FAIL"}));process.exitCode=1;}
