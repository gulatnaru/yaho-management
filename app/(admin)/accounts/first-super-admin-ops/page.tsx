import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { firstSuperAdminOpsPageAvailable } from "@/server/accounts/first-super-admin-ops-gate";
import { prepareAction, executeAction, revokeAction, reissueAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function FirstSuperAdminOpsPage() {
  if (!await firstSuperAdminOpsPageAvailable()) notFound();
  const principal = await requireAdminPrincipal();
  if (principal.userId !== process.env.YAHO_P7_OPS_APPROVER_USER_ID) notFound();
  const approvals = await prisma.bootstrapApproval.findMany({ where: { approverUserId: principal.userId }, orderBy: { approvedAt: "desc" } });
  const acceptances = await prisma.bootstrapAcceptance.findMany({ where: { approvalId: { in: approvals.map(a => a.id) } }, select: { id: true, approvalId: true, acceptedAt: true, revokedAt: true } });
  return <main><h1>최초 최고관리자 등록</h1>
    <form action={prepareAction}><label>이름 <input name="name" required /></label><label>이메일 <input name="email" type="email" required /></label><label>대면 실명 확인 시각 <input name="identityAt" type="datetime-local" required /></label><button>승인 및 전달</button></form>
    <ul>{approvals.map(a => <li key={a.id}>승인 ID: {a.id} / 대상: {a.targetEmail} / {a.revokedAt ? "철회" : "승인"}{acceptances.filter(b => b.approvalId === a.id && b.acceptedAt && !b.revokedAt).map(b => <p key={b.id}>수락 ID: {b.id}</p>)}</li>)}</ul>
    <form action={reissueAction}><label>승인 ID <input name="approvalId" required /></label><button>토큰 재발급</button></form>
    <form action={revokeAction}><label>승인 ID <input name="approvalId" required /></label><button>승인 철회</button></form>
    <form action={executeAction}><label>승인 ID <input name="approvalId" required /></label><label>수락 ID <input name="acceptanceId" required /></label><button>등록 실행</button></form>
  </main>;
}
