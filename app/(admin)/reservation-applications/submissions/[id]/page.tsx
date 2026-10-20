import { notFound } from "next/navigation";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { getApplicationWorkflowDetail } from "@/lib/reservation-applications/detail-queries";
import type { ApplicationSearchParams } from "@/lib/reservation-applications/navigation";
import { WorkflowController } from "./workflow-controller";
export const dynamic = "force-dynamic";
export default async function ApplicationSubmissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<ApplicationSearchParams> }) {
  await requireAdminPrincipal();
  const { id } = await params;
  const context = await searchParams ?? {};
  const detail = await getApplicationWorkflowDetail(id, context.applicationId);
  if (!detail) notFound();
  return <WorkflowController initialDetail={detail} context={context} />;
}
