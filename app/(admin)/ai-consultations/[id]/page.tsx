import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { notFound } from "next/navigation";
import { adminContext } from "@/server/ai-consultations/admin-context";
import { readConsultation } from "@/server/ai-consultations/admin";
export const dynamic = "force-dynamic";
export default async function AiConsultationDetail({
  params,
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  await requireAdminPrincipal();
  const ctx = await adminContext();
  const { id } = await params;
  let data;
  try {
    data = await readConsultation(
      ctx.client,
      ctx.scope,
      ctx.actor,
      ctx.keys,
      id,
    );
  } catch {
    notFound();
  }
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">합성 상담 상세</h1>
      <p>Mock 검증 자료입니다. 실제 고객 상담 기록이 아닙니다.</p>
      <h2 className="font-semibold">질문</h2>
      <p>{data.question}</p>
      <h2 className="font-semibold">안내</h2>
      <p className="whitespace-pre-wrap">{data.reply.text}</p>
    </section>
  );
}
