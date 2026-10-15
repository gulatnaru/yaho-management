export const dynamic = "force-dynamic";
/** No deployed cron/global purge is enabled before the explicit operational approval gate. */
export async function GET() {
  return Response.json(
    { error: "AI_RETENTION_NOT_ACTIVE" },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
