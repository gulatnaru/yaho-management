import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { listOwnedRepeatChildrenCore } from "@/server/reservation-applications/devices";

export const dynamic = "force-dynamic";

/** The device cookie gates this no-store DTO; no guardian matching or public Child id lookup exists. */
export async function GET() {
  const jar = await cookies();
  const owned = await listOwnedRepeatChildrenCore(prisma, { token: jar.get("yaho_application_device")?.value, now: new Date() });
  // This response is deliberately client-fetched and private/no-store: it is
  // never included in public RSC/HTML and never persisted by the browser.
  return NextResponse.json(owned, { headers: { "Cache-Control": "private, no-store" } });
}
