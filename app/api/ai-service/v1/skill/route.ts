import { disabledResponse } from "@/server/ai-service/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Intentionally does not read the body, authenticate against DB, or create a provider.
export async function POST() { return disabledResponse(); }
