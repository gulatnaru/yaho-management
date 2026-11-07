import Link from "next/link";
import { Suspense } from "react";
import { requireAdminOrSuperAdminPrincipal, type AdminPrincipal, type SuperAdminPrincipal } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { ActivateRecipientForm, GrantRecipientAssignmentForm, RegisterRecipientForm, RevokeRecipientForm, VerifyRecipientForm } from "./recipient-forms";

export const dynamic = "force-dynamic";
const time = (date: Date | null) => date?.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) ?? "—";
type Principal = AdminPrincipal | SuperAdminPrincipal;

async function managementData() {
  const runtime = await prisma.notificationRuntimeConfig.findUnique({ where: { environment: "preview" }, select: { ownerId: true, revision: true } });
  const [registrations, admins, events] = await Promise.all([
    // Deliberately select metadata only: list rendering has no ciphertext/key/decryption path.
    prisma.notificationRecipientRegistration.findMany({
      where: { environment: "preview", service: "application.received", purposeVersion: "application-received-v1", policyVersion: "g4-v1" },
      select: { id: true, version: true, state: true, userId: true, verifiedBy: true, verifiedAt: true, activatedAt: true },
      orderBy: { id: "desc" },
    }),
    prisma.user.findMany({ where: { role: "ADMIN", isActive: true, mustChangePassword: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    runtime?.ownerId ? prisma.notificationAudit.findMany({
      where: { environment: "preview", actorId: runtime.ownerId, eventType: { in: ["recipient_assignment_granted", "recipient_assignment_revoked"] }, code: { in: ["register", "verify"] }, revisionAfter: { not: null, lte: runtime.revision } },
      select: { eventType: true, payloadBinding: true, code: true, occurredAt: true },
      orderBy: { revisionAfter: "desc" },
    }) : Promise.resolve([]),
  ]);
  const assignments = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    const key = `${event.payloadBinding}:${event.code}`;
    if (event.payloadBinding && !assignments.has(key)) assignments.set(key, event);
  }
  return { runtime, registrations, admins, assignments: [...assignments.values()] };
}

async function Management({ principal }: { principal: Principal }) {
  let data: Awaited<ReturnType<typeof managementData>>;
  try { data = await managementData(); } catch {
    return <p role="alert" className="rounded border p-4">수신자 관리 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>;
  }
  const writable = principal.role === "ADMIN";
  return <div className="space-y-6">
    {!data.runtime && <p role="status">알림 운영 설정이 없습니다. 설정을 먼저 확인해주세요.</p>}
    {!writable && <p>수신자 정보는 읽기 전용입니다. 등록·검증·활성화·해지·직무 부여는 ADMIN이 수행합니다.</p>}
    {writable && <RegisterRecipientForm />}
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">수신자 등록 목록</h2>
      <p>목록에는 전화번호를 표시하지 않습니다. 검증 ADMIN은 시스템 밖에서 통화를 완료한 뒤 확인 서명을 기록합니다.</p>
      {data.registrations.length === 0 ? <p>등록된 수신자가 없습니다.</p> : data.registrations.map((row) => <article key={row.id} className="space-y-3 rounded border p-4">
        <dl className="grid gap-2 break-all text-sm sm:grid-cols-2">
          <div><dt className="font-medium">등록 ID</dt><dd>{row.id}</dd></div>
          <div><dt className="font-medium">버전</dt><dd>{row.version}</dd></div>
          <div><dt className="font-medium">상태</dt><dd>{row.state}</dd></div>
          <div><dt className="font-medium">사용자</dt><dd>{row.userId}</dd></div>
          <div><dt className="font-medium">검증 ADMIN</dt><dd>{row.verifiedBy ?? "—"}</dd></div>
          <div><dt className="font-medium">검증 시각</dt><dd>{time(row.verifiedAt)}</dd></div>
          <div><dt className="font-medium">활성화 시각</dt><dd>{time(row.activatedAt)}</dd></div>
        </dl>
        {writable && row.state === "verification_pending" && row.userId !== principal.userId && <VerifyRecipientForm registrationId={row.id} />}
        {writable && row.state === "verified_inactive" && <ActivateRecipientForm registrationId={row.id} />}
        {writable && ["verification_pending", "verified_inactive", "active"].includes(row.state) && <RevokeRecipientForm registrationId={row.id} />}
      </article>)}
    </section>
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">수신자 직무</h2>
      <p>책임자: {data.runtime?.ownerId ?? "미지정"}. 책임자는 등록·검증 직무를 직접 수행할 수 있습니다. 다른 ADMIN에게는 책임자가 직무를 부여해야 합니다.</p>
      {data.assignments.length === 0 ? <p>부여된 직무 기록이 없습니다.</p> : <ul className="space-y-2">{data.assignments.map((entry) => <li key={`${entry.payloadBinding}:${entry.code}`} className="break-all rounded border p-3">{entry.payloadBinding} · {entry.code} · {entry.eventType === "recipient_assignment_granted" ? "부여" : "해지"} · {time(entry.occurredAt)}</li>)}</ul>}
      {writable && data.runtime?.ownerId === principal.userId && <GrantRecipientAssignmentForm admins={data.admins} />}
    </section>
  </div>;
}

export default async function RecipientManagementPage() {
  const principal = await requireAdminOrSuperAdminPrincipal();
  return <section className="space-y-4">
    <Link href="/reservation-applications/notifications" className="underline">알림 이력으로</Link>
    <h1 className="text-2xl font-bold">알림 수신자 관리</h1>
    <Suspense fallback={<p role="status">수신자 관리 정보를 불러오는 중입니다.</p>}><Management principal={principal} /></Suspense>
  </section>;
}
