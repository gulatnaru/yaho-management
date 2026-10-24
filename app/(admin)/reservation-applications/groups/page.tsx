import Link from "next/link";
import { readClassLinkRevision } from "@/server/reservation-applications/groups";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { formatKstDateTime } from "@/lib/classes/datetime";
import { prisma } from "@/lib/db/prisma";
import { GroupCreateForm } from "./group-create-form";

export const dynamic = "force-dynamic";

export default async function ReservationApplicationGroupsPage() {
  await requireAdminPrincipal();
  const [classes, groups] = await Promise.all([
    prisma.classSchedule.findMany({ where: { status: "SCHEDULED", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, select: { id: true, startsAt: true, applicationPrice: true, program: { select: { name: true } } } }),
    prisma.reservationApplicationGroup.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, isActive: true, createdAt: true, links: { select: { id: true, isActive: true } }, classes: { select: { classSchedule: { select: { startsAt: true, program: { select: { name: true } } } } }, orderBy: { classSchedule: { startsAt: "asc" } } } } }),
  ]);
  const options = await Promise.all(classes.map(async (row) => ({ id: row.id, label: `${row.program.name} · ${formatKstDateTime(row.startsAt)}`, applicationPrice: row.applicationPrice, eligible: Boolean(row.applicationPrice && row.applicationPrice > 0), revision: await readClassLinkRevision(prisma, row.id) })));
  return <section className="space-y-6"><Link className="text-sm text-slate-500 hover:underline" href="/reservation-applications">예약 신청으로</Link><div><h1 className="text-2xl font-bold">예약 신청 그룹</h1><p className="mt-1 text-sm text-slate-500">가격을 명시한 서로 다른 클래스들을 하나의 보호자 신청 링크로 묶습니다.</p></div><GroupCreateForm activeLinkIds={groups.filter((group) => group.isActive).flatMap((group) => group.links.filter((link) => link.isActive).map((link) => link.id))} classes={options} /><section className="space-y-2"><h2 className="text-lg font-semibold">최근 그룹</h2>{groups.length === 0 ? <p className="text-sm text-slate-500">아직 생성한 그룹이 없습니다.</p> : <ul className="space-y-2">{groups.map((group) => <li className="rounded border p-3" key={group.id}><Link className="font-medium hover:underline" href={`/reservation-applications/groups/${group.id}`}>{group.classes.map((item) => item.classSchedule.program.name).join(" · ")}</Link><p className="mt-1 text-xs text-slate-500">{group.isActive ? "접수 가능" : "중지"}</p></li>)}</ul>}</section></section>;
}
