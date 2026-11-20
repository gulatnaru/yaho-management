import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { guidanceAdminContext } from "@/server/ai-service/guidance-context";
import { readApprovedGuidanceState } from "@/server/ai-service/guidance-admin";
import approvedRegistry from "@/server/ai-service/approved-guidance-v1.json";
import { ServiceDenied } from "@/server/ai-service/contracts";
import { saveApprovedGuidanceAction } from "./actions";
export const dynamic = "force-dynamic";
const input = "rounded border px-3 py-2 w-full";
const button = "rounded bg-slate-800 px-3 py-2 text-white";
const POLICY_V1_SHA256 = "6fac3ee24c783017d897bc90f452cc6ae8279aa889f99ef51e45d7e1e2c2e748";
const TOPICS = ["PREPARATION", "RAIN", "POLICY"] as const;
export default async function AiServiceGuidancePage() {
    const context = await guidanceAdminContext().catch((error) => {
        if (error instanceof ServiceDenied)
            return null;
        throw error;
    });
    if (!context)
        return <section className="p-6"><h1 className="text-2xl font-bold">승인 안내 원문 등록</h1><p role="status" className="mt-4">이 경로는 Preview 전용입니다. 현재 환경에서는 사용할 수 없습니다.</p></section>;
    const state = await readApprovedGuidanceState(context.db, context.environment, context.actor);
    const byTopic = new Map(state.map((row) => [row.topic, row]));
    return <main className="space-y-6 p-4 md:p-6">
  <h1 className="text-2xl font-bold">승인 안내 원문 등록</h1>
  <p>환경: {context.environment} · 주제별 현재 승인 원문 3건(PREPARATION·RAIN·POLICY)만 등록할 수 있습니다. 등록은 운영 활성화를 의미하지 않습니다. Public Skill 잠금과 기존 관리자 잠금은 그대로 유지됩니다.</p>
  {TOPICS.map((topic) => {
      const entry = approvedRegistry.entries[topic];
      const current = byTopic.get(topic);
      const match = current && topic === "POLICY" ? (current.contentSha256 === entry.sha256 ? "현재 v2 원문 일치" : current.contentSha256 === POLICY_V1_SHA256 ? "v1 원문 잔존" : "기타 내용 불일치") : null;
      return <section key={topic} aria-labelledby={`${topic}-heading`} className="rounded border p-4">
   <h2 id={`${topic}-heading`} className="font-bold">{topic} (v{entry.version})</h2>
   <p>승인 원문: {entry.filename} · {entry.characters}자 · {entry.bytes}바이트</p>
   <p>승인 해시 (SHA-256): {entry.sha256}</p>
   <div><p>저장 행 상태: {current ? `${current.topic} · DB 버전 ${current.version} · ${current.approved ? "승인" : "미승인"} · 내용 해시 ${current.contentSha256} · 최종 갱신 ${current.updatedAt.toISOString()}` : "미등록"}</p>{match && <p>원문 비교: {match}</p>}</div>
   <form action={saveApprovedGuidanceAction} className="mt-3 space-y-3">
    <input type="hidden" name="topic" value={topic}/>
    <input type="hidden" name="expectedVersion" value={current?.version ?? 0}/>
    <label>승인 원문 전문<Textarea className={input} name="content" maxLength={1000} required/></label>
    <Button className={button}>안내 저장</Button>
   </form>
  </section>;
  })}
 </main>;
}
