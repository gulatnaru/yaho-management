import Link from "next/link";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { formatKstDateTime } from "@/lib/classes/datetime";
import { prisma } from "@/lib/db/prisma";
import { GroupCreateForm } from "./group-create-form";

export const dynamic = "force-dynamic";

export default async function ReservationApplicationGroupsPage() {
  await requireAdminPrincipal();
  const [classes, groups] = await Promise.all([
    prisma.classSchedule.findMany({ where: { status: "SCHEDULED", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, select: { id: true, startsAt: true, applicationPrice: true, program: { select: { name: true } } } }),
    prisma.reservationApplicationGroup.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, isActive: true, createdAt: true, classes: { select: { classSchedule: { select: { startsAt: true, program: { select: { name: true } } } } }, orderBy: { classSchedule: { startsAt: "asc" } } } } }),
  ]);
  return <section className="space-y-6"><Link className="text-sm text-slate-500 hover:underline" href="/reservation-applications">예약 신청으로</Link><div><h1 className="text-2xl font-bold">예약 신청 그룹</h1><p className="mt-1 text-sm text-slate-500">가격을 명시한 서로 다른 클래스들을 하나의 보호자 신청 링크로 묶습니다.</p></div><GroupCreateForm classes={classes.map((row) => ({ ...row, startsAt: formatKstDateTime(row.startsAt) }))} /><section className="space-y-2"><h2 className="text-lg font-semibold">최근 그룹</h2>{groups.length === 0 ? <p className="text-sm text-slate-500">아직 생성한 그룹이 없습니다.</p> : <ul className="space-y-2">{groups.map((group) => <li className="rounded border p-3" key={group.id}><Link className="font-medium hover:underline" href={`/reservation-applications/groups/${group.id}`}>{group.classes.map((item) => item.classSchedule.program.name).join(" · ")}</Link><p className="mt-1 text-xs text-slate-500">{group.isActive ? "접수 가능" : "중지"}</p></li>)}</ul>}</section></section>;
}
