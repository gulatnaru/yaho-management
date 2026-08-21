import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calculateAge } from "@/lib/children/age";
import { getChildDetail } from "@/lib/children/queries";
import { ChildStatusToggle } from "../_components/child-status-toggle";
import { PlaceholderSection } from "../_components/placeholder-section";

const GENDER_LABEL: Record<string, string> = {
  MALE: "남",
  FEMALE: "여",
  UNSPECIFIED: "선택 안 함",
};

interface ChildDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ChildDetailPage({ params }: ChildDetailPageProps) {
  const { id } = await params;
  const child = await getChildDetail(id);

  if (!child) {
    notFound();
  }

  const age = calculateAge(child.birthDate);

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/children">
        ← 목록으로
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{child.name}</h1>
        <div className="flex items-center gap-2">
          <Link className={buttonVariants()} href={`/children/${child.id}/edit`}>
            정보 수정
          </Link>
          <ChildStatusToggle id={child.id} isActive={child.isActive} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-slate-500">생년월일</p>
            <p>
              {child.birthDate
                ? `${child.birthDate.toISOString().slice(0, 10)} (만 ${age}세)`
                : "미입력"}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">성별</p>
            <p>{GENDER_LABEL[child.gender] ?? "미입력"}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">보호자 이름</p>
            <p>{child.guardianName ?? "미입력"}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">보호자 연락처</p>
            <p>{child.guardianPhone ?? "미입력"}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">상태</p>
            <p>{child.isActive ? "활성" : "비활성"}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">등록일</p>
            <p>{child.registeredAt.toISOString().slice(0, 10)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>운영 메모</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{child.memo || "메모가 없습니다."}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PlaceholderSection description="Phase 7에서 제공 예정" title="친구관계" />
        <PlaceholderSection description="Phase 7에서 제공 예정" title="형제/자매관계" />
        <PlaceholderSection description="Phase 5에서 제공 예정" title="예약 이력" />
        <PlaceholderSection description="Phase 8에서 제공 예정" title="결제 이력" />
        <PlaceholderSection description="Phase 8에서 제공 예정" title="환불 이력" />
        <PlaceholderSection description="Phase 6에서 제공 예정" title="안전 정보 및 동의 현황" />
      </div>
    </section>
  );
}
