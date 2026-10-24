import Link from "next/link";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { listApplicationReturns } from "@/lib/reservation-applications/return-queries";
import { ApplicationReturnsWorkbench } from "../_components/application-return-card";
export const dynamic = "force-dynamic";
export default async function ApplicationReturnsPage() {
  await requireAdminPrincipal();
  const obligations = await listApplicationReturns();
  return <section className="min-w-0 space-y-6 [overflow-wrap:anywhere]"><Link className="inline-flex min-h-11 items-center text-sm underline" href="/reservation-applications">신청 목록으로</Link><h1 className="text-2xl font-bold">예약 확정 전 반환 관리</h1><p>은행에서 이미 실행한 반환 이체를 기록합니다. 예약 확정 후 환불은 기존 결제·환불 화면에서 처리합니다.</p>{obligations.length ? <ApplicationReturnsWorkbench initialObligations={obligations} /> : <p>반환 기록이 없습니다.</p>}</section>;
}
