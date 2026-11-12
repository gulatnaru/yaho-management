import {migrationChecksum,listRepositoryMigrations,evaluateMigrationState} from "../release/production-migration";
import {AI_MIGRATION} from "@/server/ai-consultations/runtime";
import {SERVICE_MIGRATION,SERVICE_MIGRATION_SHA256} from "@/server/ai-service/preview/rollback";
import type {PrismaMigrationRow} from "@/lib/e2e/preview-safety";
export function previewMigrationScope(value:string|undefined){if(value===undefined||value==="MOCK")return"MOCK";if(value==="AI_SERVICE")return"AI_SERVICE";throw new Error("PREVIEW_MIGRATION_SCOPE_DENIED");}
// Approved Preview migration baseline — union 25.
//
// Rationale (user-approved 2026-11-08, Phase 21 + G4 Preview integration):
// the Preview integration branch is G4 HEAD 350733d plus the PR #53 Mock and
// the PR #54 AI Service selective transplant. The approved inventory is the
// exact union of those lines: 13 base migrations, the Mock migration
// (20261014090000), the AI Service follow-up (20261015090000), the Outbox and
// dispatch-guard migrations, the 5 RBAC migrations, the closure-executor
// migration, the OQ-12 P0 deletion-audit migration (20261112090000), and the
// OQ-16 guidance-audit migration (20261112161600) —
// 25 in total, in this exact order. Any other inventory (missing,
// extra, reordered, or re-hashed) is denied. This is a name+order+checksum
// verification, not a count check: the count follows from the exact list.
//
// Listing the P0 migration here records its checksum for inventory
// integrity only. It does NOT authorize applying it to Preview or
// Production: that application is a separate approval (PLAN §5), and the
// scheduler stays inert until the operations gate is passed. The same holds
// for the OQ-16 guidance-audit migration listed below: listing records its
// checksum only and does NOT authorize applying it to Preview or Production.
//
// Phase 6 CRLF: the Production record for 20260825090000_phase6_safety_attendance
// holds the CRLF-variant checksum 5a4c6615cddc07185dfee17dd887e479aea2e9eb8fc98ed703b690f9b9118799
// (Production was applied from a CRLF copy of the file before the repo's LF
// normalisation). That variant is deliberately NOT listed here: the Preview
// policy requires the LF checksum 35594760d05aa8c59029548e64489af0ff9363edeb9a90b058a512233ab94eba
// for phase6 and rejects the CRLF variant, in repository files and in applied
// rows alike. The CRLF allowance in production-migration.ts
// (migrationChecksumMatchesApplied, LEGACY_CRLF_MIGRATION) applies to Production
// verification only and is NOT inherited here: applied rows are checked strictly
// against this list before evaluateMigrationState is called.
export const APPROVED_PREVIEW_MIGRATIONS: readonly {name:string;sha256:string}[]=[
 {name:"20260820050000_init",sha256:"f335199b3a731cb6dee0b9da5c4faf8e10d2bc834b93daee96c22f3ccab827cf"},
 {name:"20260820152123_add_child_name_not_blank_check",sha256:"4ef250c82f41eb1dd8613c8fc824db9df4b0411b98c85fa045c4f797547c9e7f"},
 {name:"20260821162045_add_teacher_name_not_blank_check",sha256:"30fb158959514cbeb0d2511b632705513f334044f3fecc18c5b5a409ca866586"},
 {name:"20260821170000_add_program_check_constraints",sha256:"4ddf1167c8d2c53a674a3f276ebb29e4205ef9a92aa53f465d29e00d54af2259"},
 {name:"20260825090000_phase6_safety_attendance",sha256:"35594760d05aa8c59029548e64489af0ff9363edeb9a90b058a512233ab94eba"},
 {name:"20260901090000_phase10_dashboard_cancelled_at_index",sha256:"2b12470e7064c407f77f59f5ac57ffb21c7e5a2595fd189d9f4bb08740667c1a"},
 {name:"20260913170000_phase16_account_access_management",sha256:"7801ee316770166e124ad087c7248ee84949b5df4bc42b7da9ea76633272ecc0"},
 {name:"20260929073840_phase18_reservation_applications",sha256:"5f181e0744809c3bb32d35155b8eda525be0ddc5708a85482d15ff902cac1f99"},
 {name:"20260929150958_phase18_application_consent_retention",sha256:"640416ab57b8e427333d40fb77d1e48cb1cbd26ced3ca5342a2e208b98278f21"},
 {name:"20260929155124_phase18_refund_terms_acknowledgement",sha256:"2866fb57d89494f968a0aa3a77d4a02f50734ad3c0a0894506cb2aa3d72b1a85"},
 {name:"20260929162100_phase18_child_personal_data_purge",sha256:"402b5095d96f372d3e926eb34121089a14f62a88fe8cbe44b39b296d6184bd12"},
 {name:"20260930043249_phase18_application_resolution_note_purge",sha256:"107b4b936fe68491a04f6fa0e917c5629e30b1bb635e93d490a7b4517ee257a8"},
 {name:"20261006090000_phase20_reservation_application_enhancements",sha256:"7e825e5adf052ac2b17240bfc6ee4af0ae5f279c692a32a5ba315a2dbd500121"},
 {name:"20261014090000_phase21_ai_consultations_mock",sha256:"26dc71bb2a44bb15f6dd3fd83aceb3fa109e84d29275beccc4f82d05f787026c"},
 {name:"20261015090000_ai_service_followup",sha256:"bacd02b4a1c69e19c891d0c122f08bf9f715b6d0b2e43f5899d92c329fee1b7f"},
 {name:"20261026090000_notification_outbox",sha256:"5ed492ceed6339123518aa4dc337b3ee57497459429b9b6fff863ac58d12c95c"},
 {name:"20261028090000_notification_dispatch_guard",sha256:"b056e95a5f0f4c545c7dd46444bc10dc8108f5538bf00f7af2c7cb0aecc3c59c"},
 {name:"20261031090000_admin_rbac_p1_roles",sha256:"004bce7afee0dfdfd57a9af32513a3529b7796db089574d9e02376d049e01dc2"},
 {name:"20261031100000_admin_rbac_p3_invitations",sha256:"a69cf5386be8e72be3c9ff3905c2de611af4461e2ac1fecc10c571bdbee3f9f6"},
 {name:"20261031110000_admin_rbac_p4_delivery_attempts",sha256:"d760d8cbc0fbf82f829138e12bee6f308167d6b8e2c9b869cb1340a1e58d56da"},
 {name:"20261031120000_admin_rbac_p7_bootstrap",sha256:"fae20f967883eda410f412cc92706f698dca4420046b5e013f136055457a9728"},
 {name:"20261031130000_admin_rbac_p7_delivery",sha256:"c2c37cd255b9788b7f19a2212ca63e1242deb4f287d73538584683aeda7e6ffe"},
 {name:"20261107120000_notification_closure_executor",sha256:"7a6afb15d213830c4999e293fdaf93648aac367c164b11d40d9f4ecd8b08207b"},
 {name:"20261112090000_ai_service_deletion_audit",sha256:"e4514cc1880398aaf975b8b10e8ac4b3dfa2e744c28f822cbe4c94ac29ac35d1"},
 {name:"20261112161600_ai_service_guidance_audit",sha256:"bd186e5a5d3d254af3bdf87f0caaad03c1b7dca5394e00f3f2f9ab7f8e6a159a"},
];
export const APPROVED_PREVIEW_MIGRATION_NAMES: readonly string[]=APPROVED_PREVIEW_MIGRATIONS.map(entry=>entry.name);
export function evaluateAiServicePreviewMigration(rows:PrismaMigrationRow[],migrationRoot:string){
 const names=listRepositoryMigrations(migrationRoot),active=rows.filter(row=>row.rolled_back_at===null);
 const approvedByName=new Map(APPROVED_PREVIEW_MIGRATIONS.map(entry=>[entry.name,entry.sha256]));
 if(names.length!==APPROVED_PREVIEW_MIGRATIONS.length||!names.every((name,index)=>name===APPROVED_PREVIEW_MIGRATION_NAMES[index]))throw new Error("AI_SERVICE_MIGRATION_INVENTORY_DENIED");
 for(const entry of APPROVED_PREVIEW_MIGRATIONS){if(migrationChecksum(migrationRoot,entry.name)!==entry.sha256)throw new Error(`AI_SERVICE_MIGRATION_INVENTORY_DENIED: repository migration checksum differs from the approved payload: ${entry.name}`);}
 if(migrationChecksum(migrationRoot,SERVICE_MIGRATION)!==SERVICE_MIGRATION_SHA256)throw new Error("AI_SERVICE_MIGRATION_INVENTORY_DENIED");
 for(const row of active){if(approvedByName.get(row.migration_name)!==row.checksum)throw new Error(`AI_SERVICE_MIGRATION_INVENTORY_DENIED: applied migration checksum differs from the approved payload: ${row.migration_name}`);}
 if(new Set(active.map(row=>row.migration_name)).size!==active.length||!active.some(row=>row.migration_name===AI_MIGRATION&&row.finished_at))throw new Error("AI_SERVICE_MIGRATION_INVENTORY_DENIED");
 return evaluateMigrationState({repositoryMigrations:names,rows,expectedMigrations:[SERVICE_MIGRATION],migrationRoot});
}
