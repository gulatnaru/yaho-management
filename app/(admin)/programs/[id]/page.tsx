import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WarningBanner } from "@/components/ui/warning-banner";
import { countFutureScheduledClasses } from "@/lib/programs/deactivation-warning";
import { formatDuration, formatPrice, formatTargetAgeRange } from "@/lib/programs/format";
import { getProgramDetail } from "@/lib/programs/queries";
import { ProgramStatusToggle } from "../_components/program-status-toggle";

interface ProgramDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProgramDetailPage({ params }: ProgramDetailPageProps) {
  const { id } = await params;

  const [program, futureClassCount] = await Promise.all([getProgramDetail(id), countFutureScheduledClasses(id)]);

  if (!program) {
    notFound();
  }

  const showWarning = program.status === "ACTIVE" && futureClassCount > 0;

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/programs">
        ← 목록으로
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{program.name}</h1>
        <div className="flex items-center gap-2">
          <Link className={buttonVariants()} href={`/programs/${program.id}/edit`}>
            정보 수정
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="text-sm text-slate-500">설명</p>
            <p className="whitespace-pre-wrap">{program.description || "설명이 없습니다."}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">대상연령</p>
            <p>{formatTargetAgeRange(program.targetAgeMin, program.targetAgeMax)}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">기본 소요시간</p>
            <p>{formatDuration(program.defaultDuration)}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">기본가격</p>
            <p>{formatPrice(program.defaultPrice)}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">운영상태</p>
            <p>{program.status === "ACTIVE" ? "활성" : "비활성"}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>메모</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{program.memo || "메모가 없습니다."}</p>
        </CardContent>
      </Card>

      {showWarning ? (
        <WarningBanner>이 프로그램으로 예정된 클래스 {futureClassCount}건이 있습니다.</WarningBanner>
      ) : null}

      <ProgramStatusToggle id={program.id} status={program.status} />
    </section>
  );
}
