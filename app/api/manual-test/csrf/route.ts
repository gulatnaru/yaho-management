import { createManualTestGetRoute } from "@/server/manual-test/handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createManualTestGetRoute("csrf");
