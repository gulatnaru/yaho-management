import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { markGroupManualTestSession } from "../../actions";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { formatKstDateTime } from "@/lib/classes/datetime";
import { prisma } from "@/lib/db/prisma";
import { GroupLinkButton } from "../group-link-button";
import { GroupEditForm } from "../group-edit-form";

export const dynamic = "force-dynamic";

export default async function ReservationApplicationGroupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ manualSessionError?: string }> }) {
  await requireAdminPrincipal();
  const { id } = await params;
  const group = await prisma.reservationApplicationGroup.findUnique({ where: { id }, select: { id: true, isActive: true, syntheticRunId: true, classes: { select: { classSchedule: { select: { id: true, startsAt: true, status: true, applicationPrice: true, program: { select: { name: true } } } } }, orderBy: { classSchedule: { startsAt: "asc" } } }, links: { where: { isActive: true }, orderBy: { issuedAt: "desc" }, take: 1, select: { issuedAt: true } } } });
  if (!group) notFound();
  const selected = new Set(group.classes.map((item) => item.classSchedule.id));
  const now = new Date();
  const classes = await prisma.classSchedule.findMany({ where: { status: "SCHEDULED", startsAt: { gt: now } }, select: { id: true, startsAt: true, status: true, applicationPrice: true, program: { select: { name: true } } }, orderBy: { startsAt: "asc" }, take: 100 });
  const options = new Map(classes.map((item) => [item.id, item]));
  for (const item of group.classes) options.set(item.classSchedule.id, item.classSchedule);
  const manualSessionError = process.env.VERCEL_ENV === "preview" ? (await searchParams)?.manualSessionError : undefined;
  async function markManualSession() {
    "use server";
    const result = await markGroupManualTestSession(id);
    const path = `/reservation-applications/groups/${encodeURIComponent(id)}`;
    if (result.error) redirect(`${path}?${new URLSearchParams({ manualSessionError: result.error })}`);
    revalidatePath(path);
    redirect(path);
  }
  return <section className="space-y-6"><Link className="text-sm text-slate-500 hover:underline" href="/reservation-applications/groups">그룹 목록으로</Link><div><h1 className="text-2xl font-bold">신청 그룹</h1><p className="mt-1 text-sm text-slate-500">링크 원문은 발급 직후에만 표시합니다.</p></div><ul className="space-y-2">{group.classes.map((item) => <li className="rounded border p-3" key={item.classSchedule.id}>{item.classSchedule.program.name} · {formatKstDateTime(item.classSchedule.startsAt)} · {item.classSchedule.applicationPrice?.toLocaleString("ko-KR")}원</li>)}</ul><GroupEditForm classes={[...options.values()].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime()).map((item) => ({ id: item.id, label: `${item.program.name} · ${formatKstDateTime(item.startsAt)}`, applicationPrice: item.applicationPrice, selected: selected.has(item.id), eligible: item.status === "SCHEDULED" && item.startsAt > now && Boolean(item.applicationPrice && item.applicationPrice > 0) }))} groupId={group.id} isActive={group.isActive} /><GroupLinkButton groupId={group.id} isActive={group.isActive} />{process.env.VERCEL_ENV === "preview" ? (
    <Card>
      <CardHeader><CardTitle>모바일 테스트 세션</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-600">같은 브라우저에서 운영자로 로그인한 뒤 신청 링크를 열어 테스트할 수 있습니다.</p>
        {group.syntheticRunId ? <p className="break-all text-sm">테스트 실행 ID: <code>{group.syntheticRunId}</code></p> : null}
        <form action={markManualSession}>
          <Button disabled={Boolean(group.syntheticRunId)} type="submit">모바일 테스트 세션으로 지정</Button>
        </form>
        {manualSessionError ? <p className="text-sm text-red-600" role="alert">{manualSessionError}</p> : null}
      </CardContent>
    </Card>
  ) : null}</section>;
}
