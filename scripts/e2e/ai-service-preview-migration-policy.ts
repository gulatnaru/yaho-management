import {migrationChecksum,listRepositoryMigrations,evaluateMigrationState} from "../release/production-migration";
import {AI_MIGRATION} from "@/server/ai-consultations/runtime";
import {SERVICE_MIGRATION,SERVICE_MIGRATION_SHA256} from "@/server/ai-service/preview/rollback";
import type {PrismaMigrationRow} from "@/lib/e2e/preview-safety";
export function previewMigrationScope(value:string|undefined){if(value===undefined||value==="MOCK")return"MOCK";if(value==="AI_SERVICE")return"AI_SERVICE";throw new Error("PREVIEW_MIGRATION_SCOPE_DENIED");}
export function evaluateAiServicePreviewMigration(rows:PrismaMigrationRow[],migrationRoot:string){
 const names=listRepositoryMigrations(migrationRoot),active=rows.filter(row=>row.rolled_back_at===null);
 if(names.length!==15||names.at(-1)!==SERVICE_MIGRATION||migrationChecksum(migrationRoot,SERVICE_MIGRATION)!==SERVICE_MIGRATION_SHA256||new Set(active.map(row=>row.migration_name)).size!==active.length||!active.some(row=>row.migration_name===AI_MIGRATION&&row.finished_at))throw new Error("AI_SERVICE_MIGRATION_INVENTORY_DENIED");
 return evaluateMigrationState({repositoryMigrations:names,rows,expectedMigrations:[SERVICE_MIGRATION],migrationRoot});
}
