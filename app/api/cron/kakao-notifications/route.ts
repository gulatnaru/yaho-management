export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return dispatchPreview(request);
}
import { dispatchPreview } from "@/server/kakao/dispatcher";

