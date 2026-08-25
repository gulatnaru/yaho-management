import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getChildDetail } from "@/lib/children/queries";
import { getChildSafetyInfo } from "@/lib/children/safety-info/queries";
import { SafetyForm } from "./safety-form";

export default async function ChildSafetyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [child, safetyInfo] = await Promise.all([getChildDetail(id), getChildSafetyInfo(id)]);
  if (!child) notFound();
  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href={`/children/${id}`}>아이 상세로</Link>
      <div>
        <h1 className="text-2xl font-bold">{child.name} 안전 정보</h1>
        <p className="mt-2 text-sm text-slate-600">민감정보는 운영자 권한으로만 조회·수정됩니다.</p>
      </div>
      <SafetyForm childId={id} values={safetyInfo} />
      <Link className={cn(buttonVariants(), "bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100")} href={`/children/${id}`}>취소</Link>
    </section>
  );
}
