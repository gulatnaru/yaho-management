import Link from "next/link";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { AiDenied } from "@/lib/ai-consultations/contracts";
import { Button } from "@/components/ui/button";
import { adminContext } from "@/server/ai-consultations/admin-context";
import { readAdminState } from "@/server/ai-consultations/admin";
import {
  savePublication,
  saveGuidance,
  retryRetention,
  recoverRequests,
} from "./actions";
export const dynamic = "force-dynamic";
export default async function AiConsultationsPage() {
  await requireAdminPrincipal();
  let ctx;
  try {
    ctx = await adminContext();
  } catch (error) {
    if (!(error instanceof AiDenied)) throw error;
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-bold">AI 상담 — Mock 전용</h1>
        <p>
          실제 카카오·OpenAI와 연결되지 않았습니다. 승인된 Preview 검증 실행이
          없으므로 기능이 잠겨 있습니다.
        </p>
      </section>
    );
  }
  const state = await readAdminState(ctx.client, ctx.scope, ctx.actor);
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI 상담 — 합성 데이터 검증</h1>
        <p className="text-sm text-slate-600">
          실제 카카오·OpenAI 미연동 · 실제 고객 데이터 처리 금지 · 운영 활성화
          별도 승인
        </p>
      </div>
      <section className="space-y-3 rounded border p-4">
        <h2 className="font-semibold">AI 공개 설정</h2>
        <p className="text-sm">
          기본 비공개입니다. 프로그램과 일정을 모두 허용해야 안내하며 예약신청
          링크 설정과 독립적입니다.
        </p>
        {[
          ...ctx.scope.manifest.programIds.map((id) => ({
            kind: "PROGRAM",
            id,
            ...state.programs.find((x) => x.programId === id),
          })),
          ...ctx.scope.manifest.classIds.map((id) => ({
            kind: "CLASS",
            id,
            ...state.classes.find((x) => x.classScheduleId === id),
          })),
        ].map((item) => (
          <form
            key={item.kind + item.id + ":" + (item.version ?? 0)}
            action={savePublication}
            className="flex flex-wrap items-center gap-3"
          >
            <input type="hidden" name="kind" value={item.kind} />
            <input type="hidden" name="id" value={item.id} />
            <input
              type="hidden"
              name="expectedVersion"
              value={item.version ?? 0}
            />
            <span>
              {item.kind === "PROGRAM" ? "합성 프로그램" : "합성 일정"}{" "}
              {item.id.slice(-6)}
            </span>
            <span>{item.enabled ? "허용" : "비공개"}</span>
            <input type="hidden" name="enabled" value={item.enabled ? "false" : "true"} />
            <Button type="submit">
              {item.enabled ? "공개 해제" : "AI 공개 허용"}
            </Button>
          </form>
        ))}
      </section>
      <section className="space-y-3 rounded border p-4">
        <h2 className="font-semibold">안내 원문</h2>
        <p>
          공식 운영정책·준비물·우천 원문은 미확보입니다. 아래 승인은 합성 테스트
          자료만 대상으로 합니다.
        </p>
        {(["POLICY", "PREPARATION", "RAIN"] as const).map((topic) => {
          const row = state.knowledge.find((x) => x.topic === topic);
          return (
            <form
              key={topic + ":" + (row?.version ?? 0)}
              action={saveGuidance}
              className="flex flex-wrap gap-3"
            >
              <input type="hidden" name="topic" value={topic} />
              <input
                type="hidden"
                name="expectedVersion"
                value={row?.version ?? 0}
              />
              <span>
                {topic} — {row?.approved ? "합성 승인" : "미승인"}
              </span>
              <input type="hidden" name="approved" value={row?.approved ? "false" : "true"} />
              <Button type="submit">
                {row?.approved ? "승인 해제" : "합성 자료 승인"}
              </Button>
            </form>
          );
        })}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">상담 내역</h2>
        <p className="text-sm">
          원문은 암호화하며 수집 시각부터 90일 후 조회 차단·삭제 대상입니다.
          만료된 상담은 표시하지 않습니다.
        </p>
        {state.consultations.length === 0 ? (
          <p>상담 내역이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {state.consultations.map((x) => (
              <li key={x.id}>
                <Link href={"/ai-consultations/" + x.id}>
                  {x.createdAt.toISOString()} · {x.status} ·{" "}
                  {x.resultCategory ?? "처리 중"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-3 rounded border p-4">
        <h2 className="font-semibold">보관기간·실패 관리</h2>
        <p>
          상태: {state.job?.status ?? "미실행"} · 삭제{" "}
          {state.job?.deletedCount ?? 0}건 · 오류{" "}
          {state.job?.errorCode ?? "없음"}
        </p>
        <p>
          자동 운영 삭제 스케줄은 비활성입니다. 현재 실행 소유 합성 상담만
          정리합니다.
        </p>
        <div className="flex flex-wrap gap-3">
          <form action={retryRetention}>
            <Button>만료 합성 상담 삭제 재시도</Button>
          </form>
          <form action={recoverRequests}>
            <Button>중단 요청 복구</Button>
          </form>
        </div>
      </section>
      <section>
        <h2 className="font-semibold">비식별 합성 통계</h2>
        <p className="text-sm">
          원문·사용자·실행 연결키 없이 날짜와 처리 유형만 유지합니다. 실제
          OpenAI 비용은 0입니다.
        </p>
        <ul>
          {state.metrics.map((x) => (
            <li key={x.day.toISOString() + x.category}>
              {x.day.toISOString().slice(0, 10)} {x.category}: {x.count}건
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
