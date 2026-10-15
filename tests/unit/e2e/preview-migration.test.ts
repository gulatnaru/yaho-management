import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluatePhase21PreviewMigration, previewMigrationStage, runPreviewPrisma } from "@/scripts/e2e/preview-migration";
import { AI_MIGRATION } from "@/server/ai-consultations/runtime";
import type { PrismaMigrationRow } from "@/lib/e2e/preview-safety";
const roots:string[]=[];
function fixture(extra=false) {
  const root=mkdtempSync(path.join(os.tmpdir(),"yaho-migration-test-")); roots.push(root);
  const names=["20261013000000_existing",AI_MIGRATION,...(extra?["20261016000000_unapproved"]:[])];
  for(const name of names) {mkdirSync(path.join(root,name));writeFileSync(path.join(root,name,"migration.sql"),"-- "+name);}
  const row=(name:string):PrismaMigrationRow=>({migration_name:name,checksum:createHash("sha256").update("-- "+name).digest("hex"),finished_at:new Date(),rolled_back_at:null});
  return {root,names,row};
}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
describe("approved nonproduction migration inventory",()=>{
  it("permits exactly pending Phase21, and verifies an already applied candidate idempotently",()=>{
    const f=fixture();const first=f.row(f.names[0]);
    expect(evaluatePhase21PreviewMigration([first],f.root)).toMatchObject({pendingMigrations:[AI_MIGRATION],deployRequired:true});
    expect(evaluatePhase21PreviewMigration([first,f.row(AI_MIGRATION)],f.root)).toMatchObject({pendingMigrations:[],deployRequired:false});
  });
  it("refuses unrelated pending migrations and unknown/changed/failed histories",()=>{
    const f=fixture(true); const first=f.row(f.names[0]);
    expect(()=>evaluatePhase21PreviewMigration([first],f.root)).toThrow();
    const g=fixture();const base=g.row(g.names[0]);
    for(const rows of [[{...base,checksum:"0".repeat(64)}],[{...base,finished_at:null}],[base,g.row("unknown")],[base,base]])expect(()=>evaluatePhase21PreviewMigration(rows,g.root)).toThrow();
  });
  it("never accepts an arbitrary Prisma stage and captures command output",async ()=>{
    expect(()=>previewMigrationStage("reset")).toThrow();
    expect(()=>previewMigrationStage(undefined)).toThrow();
    const run=vi.fn((_binary,_args,_options,callback)=>callback(null)); await runPreviewPrisma("deploy","postgresql://synthetic.invalid/test",undefined,run as never);
    expect(run.mock.calls[0][1]).toEqual([path.resolve("node_modules/prisma/build/index.js"),"migrate","deploy","--schema",path.resolve("prisma/schema.prisma")]);
    expect(run.mock.calls[0][2]).toMatchObject({maxBuffer:1024*1024,timeout:120000});
  });
});
