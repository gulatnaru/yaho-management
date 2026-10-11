import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { formatKstDateTime } from "@/lib/classes/datetime";
import { prisma } from "@/lib/db/prisma";
import { DepositForm } from "./deposit-form";
import { SubmissionConfirmationForm } from "./confirmation-form";

export const dynamic = "force-dynamic";
export default async function ApplicationSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPrincipal(); const { id } = await params;
  const submission = await prisma.reservationApplicationSubmission.findUnique({
    where: { id },
    select: {
      id: true, guardianName: true, guardianPhone: true, declaredPayerName: true, submittedAt: true, depositNotifiedAt: true,
      applications: { select: { id: true, childName: true, childBirthDate: true, childGender: true, requestedChildId: true, quotedAmount: true, status: true, classSchedule: { select: { startsAt: true, program: { select: { name: true } } } } } },
      deposits: { orderBy: [{ confirmedAt: "asc" }, { id: "asc" }], select: { id: true, amount: true, payerName: true, depositedAt: true, confirmedAt: true, confirmedBy: { select: { name: true } }, allocations: { select: { amount: true } } } },
      returnObligations: { select: { id: true, kind: true, amount: true, returnedAmount: true, resolvedAt: true, returns: { orderBy: [{ returnedAt: "asc" }, { id: "asc" }], select: { id: true, amount: true, returnedAt: true, createdAt: true, reason: true, processedBy: { select: { name: true } } } } } },
    },
  });
  if (!submission) notFound();
  const quoteTotal = submission.applications.reduce((sum, item) => sum + (item.quotedAmount ?? 0), 0);
  const deposited = submission.deposits.reduce((sum, item) => sum + item.amount, 0);
  const allocated = submission.deposits.flatMap((item) => item.allocations).reduce((sum, item) => sum + item.amount, 0);
  const pending = submission.applications.filter((application) => application.status === "SUBMITTED" && application.childName && application.childBirthDate && application.quotedAmount);
  const candidates = await Promise.all(pending.map(async (application) => ({ id: application.id, children: submission.guardianName && submission.guardianPhone ? await prisma.child.findMany({ where: { name: application.childName!, birthDate: application.childBirthDate!, gender: application.childGender!, guardianName: submission.guardianName, guardianPhone: submission.guardianPhone, isActive: true, personalDataPurgedAt: null }, select: { id: true, name: true, gender: true }, orderBy: { id: "asc" } }) : [] })));
  return <section className="space-y-6"><Link className="text-sm text-slate-500 hover:underline" href="/reservation-applications">신청 목록으로</Link><div><h1 className="text-2xl font-bold">가족 신청 및 입금</h1><p className="text-sm text-slate-500">신고 입금자 {submission.declaredPayerName ?? "파기됨"} · 신청금 {quoteTotal.toLocaleString("ko-KR")}원 · 확인 입금 {deposited.toLocaleString("ko-KR")}원 · 미배정 {Math.max(0, deposited - allocated).toLocaleString("ko-KR")}원</p>{submission.depositNotifiedAt ? <p className="text-sm text-emerald-700">보호자가 입금 알림을 보냈습니다.</p> : null}</div><section className="space-y-2"><h2 className="font-semibold">아이별 신청</h2>{submission.applications.map((item) => <div className="rounded border p-3" key={item.id}>{item.childName ?? "파기됨"} · {item.classSchedule.program.name} · 수업일시 {formatKstDateTime(item.classSchedule.startsAt)} · {item.quotedAmount?.toLocaleString("ko-KR") ?? "금액 없음"}원 · {item.status}</div>)}</section>{pending.length > 0 ? <section className="space-y-3"><h2 className="font-semibold">선택 일괄 확정</h2><p className="text-sm text-slate-500">선택한 아이는 하나의 입금 잔액 검증과 하나의 이체 결제로 함께 확정됩니다.</p><SubmissionConfirmationForm submissionId={submission.id} applications={pending.map((application) => ({ id: application.id, childName: application.childName, quotedAmount: application.quotedAmount, candidates: candidates.find((candidate) => candidate.id === application.id)?.children.map((child) => ({ id: child.id, label: `${child.name} · ${child.gender} · 기존 아이`, isRequested: child.id === application.requestedChildId })) ?? [] }))} /></section> : null}<section className="space-y-3"><h2 className="font-semibold">실제 입금</h2><DepositForm submissionId={submission.id} />{submission.deposits.map((item) => <div className="rounded border p-3 text-sm" key={item.id}><p>실제 입금자 {item.payerName ?? "파기됨"} · {item.amount.toLocaleString("ko-KR")}원 · 배정 {item.allocations.reduce((sum, allocation) => sum + allocation.amount, 0).toLocaleString("ko-KR")}원</p><p>입금일시 {formatKstDateTime(item.depositedAt)} · 확인일시 {formatKstDateTime(item.confirmedAt)} · 확인자 {item.confirmedBy.name ?? "-"}</p></div>)}</section><section className="space-y-2"><h2 className="font-semibold">예약 확정 전 반환 내역</h2>{submission.returnObligations.length === 0 ? <p className="text-sm text-slate-500">반환 기록이 없습니다.</p> : submission.returnObligations.map((item) => <div className="rounded border p-3 text-sm" key={item.id}>{item.kind} · 반환 필요 {item.amount.toLocaleString("ko-KR")}원 · 완료 반환 {item.returnedAmount.toLocaleString("ko-KR")}원 · {item.resolvedAt ? "완료" : "처리 대기"}{item.returns.map((record) => <p key={record.id}>반환일시 {formatKstDateTime(record.returnedAt)} · 처리일시 {formatKstDateTime(record.createdAt)} · {record.amount.toLocaleString("ko-KR")}원 · 사유 {record.reason ?? "-"} · 처리자 {record.processedBy.name ?? "-"}</p>)}</div>)}</section><Link className="text-sm underline" href="/reservation-applications/returns">반환 처리 대기 보기</Link></section>;
}
