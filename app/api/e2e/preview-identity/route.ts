import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  assertApprovedSupabaseProjectRef,
  assertApprovedRuntimeDatabaseIdentity,
  assertPreviewHandshakeRequest,
  prismaSchemaTargetFromDatabaseUrl,
  PreviewE2eSafetyError,
  type RuntimeDatabaseIdentity,
} from "@/lib/e2e/preview-safety";

export const dynamic = "force-dynamic";

/**
 * Only the manual Preview runner may read this opaque proof. It contains neither
 * a connection string nor raw database identity values.
 */
export async function GET(request: Request) {
  try {
    assertPreviewHandshakeRequest({
      vercelEnv: process.env.VERCEL_ENV,
      expectedSecret: process.env.PREVIEW_E2E_HANDSHAKE_SECRET,
      suppliedSecret: request.headers.get("x-yaho-preview-e2e-handshake"),
      expectedFingerprint: process.env.PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256,
    });
    const projectRef = assertApprovedSupabaseProjectRef({
      databaseUrl: process.env.DATABASE_URL,
      expectedProjectRef: process.env.PREVIEW_E2E_SUPABASE_PROJECT_REF,
    });
    const prismaSchema = prismaSchemaTargetFromDatabaseUrl(process.env.DATABASE_URL);
    const rows = await prisma.$queryRaw<RuntimeDatabaseIdentity[]>`
      SELECT current_database() AS database, current_user AS "currentUser", current_schema() AS "currentSchema"
    `;
    const identity = rows[0];
    if (!identity) throw new PreviewE2eSafetyError("DATABASE_IDENTITY_UNKNOWN", "Preview E2E identity is unavailable");
    const fingerprint = assertApprovedRuntimeDatabaseIdentity(
      identity,
      projectRef,
      process.env.PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256,
      prismaSchema,
    );
    const deploymentSha = process.env.VERCEL_GIT_COMMIT_SHA;
    if (!deploymentSha) throw new PreviewE2eSafetyError("DEPLOYMENT_SHA_UNKNOWN", "Preview E2E identity is unavailable");

    return NextResponse.json({ fingerprint, deploymentSha }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof PreviewE2eSafetyError ? 403 : 503;
    return NextResponse.json({ error: "Preview E2E identity is unavailable" }, { status });
  }
}
