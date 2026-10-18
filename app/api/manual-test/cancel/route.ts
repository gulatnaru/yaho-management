import { createManualTestPostRoute } from "@/server/manual-test/handler";
export const runtime = "nodejs";
export const POST = createManualTestPostRoute("cancel");
