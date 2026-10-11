import Link from "next/link";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { getReservationApplicationSettings } from "@/server/reservation-applications/settings";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function ReservationApplicationSettingsPage() {
  await requireAdminPrincipal();
  const settings = await getReservationApplicationSettings(prisma);
  return <section className="space-y-6"><Link className="text-sm text-slate-500 hover:underline" href="/reservation-applications">예약 신청으로</Link><div><h1 className="text-2xl font-bold">예약 신청 운영 설정</h1><p className="mt-1 text-sm text-slate-500">완료 안내와 새 유료 신청 그룹에 사용할 입금 계좌와 채널입니다.</p></div><SettingsForm settings={settings} /></section>;
}
