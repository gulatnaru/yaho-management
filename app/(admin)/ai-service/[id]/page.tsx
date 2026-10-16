import { notFound } from "next/navigation";
import { adminContext } from "@/server/ai-service/admin-context";
import { readConsultation } from "@/server/ai-service/admin";
export const dynamic = "force-dynamic";
export default async function Consultation({ params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const context = await adminContext().catch(() => null);
    if (!context)
        return <p className="p-6">상담 조회가 비활성화되어 있습니다.</p>;
    const { id } = await params;
    const record = await readConsultation(context.db, context.environment, context.actor, context.keys, id).catch(() => null);
    if (!record)
        notFound();
    return <main className="space-y-4 p-6"><h1 className="text-xl font-bold">상담 원문</h1><p className="whitespace-pre-wrap">{record.utterance}</p><p className="whitespace-pre-wrap">{record.reply}</p></main>;
}
