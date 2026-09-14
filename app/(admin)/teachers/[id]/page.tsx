import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WarningBanner } from "@/components/ui/warning-banner";
import { requireCurrentPrincipal } from "@/lib/auth/authorization";
import { toTelHref } from "@/lib/shared/contact";
import { countFutureScheduledAssignments } from "@/lib/teachers/deactivation-warning";
import { getTeacherDetailForPrincipal } from "@/lib/teachers/queries";
import { TeacherStatusToggle } from "../_components/teacher-status-toggle";

interface TeacherDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TeacherDetailPage({ params }: TeacherDetailPageProps) {
  const principal = await requireCurrentPrincipal();
  const { id } = await params;

  const canManage = principal.role === "ADMIN" || principal.role === "MANAGER";

  const [teacher, futureAssignmentCount] = await Promise.all([
    getTeacherDetailForPrincipal(id, principal),
    canManage ? countFutureScheduledAssignments(id) : Promise.resolve(0),
  ]);

  if (!teacher) {
    notFound();
  }

  const showWarning = teacher.isActive && futureAssignmentCount > 0;

  return (
    <section className="space-y-6">
      {canManage ? (
        <Link className="text-sm text-slate-500 hover:underline" href="/teachers">
          ← 목록으로
        </Link>
      ) : null}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{teacher.name}</h1>
        <div className="flex items-center gap-2">
          {canManage ? (
            <Link className={buttonVariants()} href={`/teachers/${teacher.id}/edit`}>
              정보 수정
            </Link>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-slate-500">연락처</p>
            <p>
              {teacher.phone ? (
                <a className="hover:underline" href={toTelHref(teacher.phone)}>
                  {teacher.phone}
                </a>
              ) : (
                "미입력"
              )}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">상태</p>
            <p>{teacher.isActive ? "활성" : "비활성"}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>운영 메모</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{teacher.memo || "메모가 없습니다."}</p>
        </CardContent>
      </Card>

      {canManage && showWarning ? (
        <WarningBanner>이 선생님은 예정된 클래스 {futureAssignmentCount}건에 배정되어 있습니다.</WarningBanner>
      ) : null}

      {canManage ? <TeacherStatusToggle id={teacher.id} isActive={teacher.isActive} /> : null}
    </section>
  );
}
