import { HUMAN_HANDOFF, skillReply } from "@/lib/ai-consultations/contracts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Real channel ingestion is deliberately unavailable; no body read, persistence or provider. */
export async function POST() {
  return Response.json(
    skillReply({ category: "HUMAN_HANDOFF", text: HUMAN_HANDOFF }),
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
