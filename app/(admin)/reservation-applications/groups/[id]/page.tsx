import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { formatKstDateTime } from "@/lib/classes/datetime";
import { prisma } from "@/lib/db/prisma";
import { GroupLinkButton } from "../group-link-button";
import { GroupEditForm } from "../group-edit-form";

export const dynamic = "force-dynamic";

export default async function ReservationApplicationGroupPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPrincipal();
  const { id } = await params;
  const group = await prisma.reservationApplicationGroup.findUnique({ where: { id }, select: { id: true, isActive: true, classes: { select: { classSchedule: { select: { id: true, startsAt: true, status: true, applicationPrice: true, program: { select: { name: true } } } } }, orderBy: { classSchedule: { startsAt: "asc" } } }, links: { where: { isActive: true }, orderBy: { issuedAt: "desc" }, take: 1, select: { issuedAt: true } } } });
  if (!group) notFound();
  const selected = new Set(group.classes.map((item) => item.classSchedule.id));
  const now = new Date();
  const classes = await prisma.classSchedule.findMany({ where: { status: "SCHEDULED", startsAt: { gt: now } }, select: { id: true, startsAt: true, status: true, applicationPrice: true, program: { select: { name: true } } }, orderBy: { startsAt: "asc" }, take: 100 });
  const options = new Map(classes.map((item) => [item.id, item]));
  for (const item of group.classes) options.set(item.classSchedule.id, item.classSchedule);
  return <section className="space-y-6"><Link className="text-sm text-slate-500 hover:underline" href="/reservation-applications/groups">그룹 목록으로</Link><div><h1 className="text-2xl font-bold">신청 그룹</h1><p className="mt-1 text-sm text-slate-500">링크 원문은 발급 직후에만 표시합니다.</p></div><ul className="space-y-2">{group.classes.map((item) => <li className="rounded border p-3" key={item.classSchedule.id}>{item.classSchedule.program.name} · {formatKstDateTime(item.classSchedule.startsAt)} · {item.classSchedule.applicationPrice?.toLocaleString("ko-KR")}원</li>)}</ul><GroupEditForm classes={[...options.values()].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime()).map((item) => ({ id: item.id, label: `${item.program.name} · ${formatKstDateTime(item.startsAt)}`, applicationPrice: item.applicationPrice, selected: selected.has(item.id), eligible: item.status === "SCHEDULED" && item.startsAt > now && Boolean(item.applicationPrice && item.applicationPrice > 0) }))} groupId={group.id} isActive={group.isActive} /><GroupLinkButton groupId={group.id} isActive={group.isActive} /></section>;
}
