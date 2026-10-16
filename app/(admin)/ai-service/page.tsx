import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import { adminContext } from "@/server/ai-service/admin-context";
import { readState } from "@/server/ai-service/admin";
import { saveConfigAction, saveGuidanceAction, savePublicationAction, reconcileAction, retryRetentionAction } from "./actions";
export const dynamic = "force-dynamic";
const input = "rounded border px-3 py-2 w-full";
const button = "rounded bg-slate-800 px-3 py-2 text-white";
export default async function AiServicePage() {
    const context = await adminContext().catch(() => null);
    if (!context)
        return <section className="p-6"><h1 className="text-2xl font-bold">AI 상담 실연동 관리</h1><p role="status" className="mt-4">별도 DB 검증·개인정보 검토·운영 승인이 필요합니다. 현재 연결과 설정 변경은 비활성화되어 있습니다.</p></section>;
    const state = await readState(context.db, context.environment, context.actor, new Date());
    const config = state.config;
    return <main className="space-y-6 p-4 md:p-6">
  <h1 className="text-2xl font-bold">AI 상담 실연동 관리</h1>
  <p>환경: {context.environment} · 월 청구 목표 10,000원 · 환경 호출 한도 {context.environment === "PREVIEW" ? "1,000" : "7,000"}원</p>
  <p>예상 청구액은 실제 청구와 다를 수 있습니다. 운영 활성화는 별도 승인 사항입니다.</p>
  <section className="rounded border p-4"><h2 className="font-bold">Provider·가격·환율</h2><p>모델·단가는 최초 평가 후보입니다. 실제 계정 가격·사용량 과금 계약 확인 전 운영 호출은 허용되지 않습니다.</p>
   <form action={saveConfigAction} className="mt-3 grid gap-3 md:grid-cols-2">
    <input type="hidden" name="expectedVersion" value={config?.version ?? 0}/>
    <label>Provider<Select className={input} name="provider" defaultValue={config?.provider ?? "TEST_DOUBLE"}><option>TEST_DOUBLE</option><option>OPENAI</option></Select></label>
    <label>운영 중지<Select className={input} name="paused" defaultValue={(config?.paused ?? true) ? "true" : "false"}><option value="true">호출 중지</option><option value="false">호출 허용 요청 (별도 활성화 승인 필요)</option></Select></label>
    <label>모델<Input className={input} name="model" defaultValue={config?.model ?? "gpt-6-luna"} required/></label>
    <label>가격 버전<Input className={input} name="priceVersion" defaultValue={config?.priceVersion ?? ""} required/></label>
    <label>입력 단가 (nano USD/token)<Input className={input} name="inputNanoUsdPerToken" type="number" min="1" defaultValue={config?.inputNanoUsdPerToken ?? 100} required/></label>
    <label>출력 단가 (nano USD/token)<Input className={input} name="outputNanoUsdPerToken" type="number" min="1" defaultValue={config?.outputNanoUsdPerToken ?? 500} required/></label>
    <label>환율 (milli KRW/USD)<Input className={input} name="fxMilliKrwPerUsd" type="number" min="100000" defaultValue={config?.fxMilliKrwPerUsd ?? ""} required/></label>
    <label>환율 확인 시각 (UTC)<Input className={input} name="fxCheckedAt" placeholder="YYYY-MM-DDTHH:mm:ssZ" required/></label>
    <label>환율 출처<Input className={input} name="fxSource" maxLength={120} defaultValue={config?.fxSource ?? ""} required/></label>
    <Button className={button}>설정 저장</Button>
   </form>
  </section>
  <section className="rounded border p-4"><h2 className="font-bold">프로그램·일정 공개</h2>
   <p>공개 링크와 독립입니다. 프로그램과 일정 모두 허용해야 합니다.</p>
   <form action={savePublicationAction} className="mt-3 grid gap-3 md:grid-cols-2">
    <label>종류<Select className={input} name="kind"><option value="PROGRAM">프로그램</option><option value="CLASS">일정</option></Select></label>
    <label>대상 ID<Input className={input} name="id" required/></label>
    <label>현재 버전<Input className={input} type="number" name="expectedVersion" min="0" defaultValue="0"/></label>
    <label>상태<Select className={input} name="enabled"><option value="false">비공개</option><option value="true">공개</option></Select></label>
    <Button className={button}>공개 설정 저장</Button>
   </form>
   <ul className="mt-3">{state.programs.map(p => <li key={p.id}>프로그램 {p.programId} · {p.enabled ? "공개" : "비공개"} · 버전 {p.version}</li>)}{state.classes.map(c => <li key={c.id}>일정 {c.classScheduleId} · {c.enabled ? "공개" : "비공개"} · 버전 {c.version}</li>)}</ul>
  </section>
  <section className="rounded border p-4"><h2 className="font-bold">공식 안내</h2>
   <form action={saveGuidanceAction} className="mt-3 space-y-3">
    <label>주제<Select className={input} name="topic"><option>POLICY</option><option>PREPARATION</option><option>RAIN</option></Select></label>
    <label>공식 원문<Textarea className={input} name="content" maxLength={1000} required/></label>
    <label>현재 버전<Input className={input} name="expectedVersion" type="number" min="0" defaultValue="0"/></label>
    <label>승인<Select className={input} name="approved"><option value="false">미승인</option><option value="true">승인</option></Select></label>
    <Button className={button}>안내 저장</Button>
   </form>
   {state.knowledge.map(k => <p key={k.id}>{k.topic} · 버전 {k.version} · {k.approved ? "승인" : "미승인"}</p>)}
  </section>
  <section className="rounded border p-4"><h2 className="font-bold">예산·청구 대조</h2>
   {state.budgets.length === 0 ? <p>예산 내역이 없습니다.</p> : state.budgets.map(b => <div key={b.id} className="my-3 space-y-2 rounded border p-3">
    <p>{b.month} · 사용 {b.usedKrw}원 · 예약 {b.reservedKrw}원 · 보정 {b.correctionKrw}원 · 미확정 {b.unknownCount}건 · 청구 확인 {b.billedKrw}원</p>
    <form action={reconcileAction} className="grid gap-2 md:grid-cols-2">
     <input type="hidden" name="coveredThroughGeneration" value={b.dispatchGeneration}/><input type="hidden" name="month" value={b.month}/><input type="hidden" name="expectedVersion" value={b.version}/>
     <label>확인 청구액<Input className={input} name="billedKrw" type="number" min={b.billedKrw} required/></label>
     <label>전체 미확정 실사용액<Input className={input} name="heldActualKrw" type="number" min="0" defaultValue="0"/></label>
     <label className="md:col-span-2"><input type="checkbox" name="coverageConfirmed" value="true" required/> 실제 외부 청구명세가 {b.dispatchGeneration}차 호출까지 모든 미확정 비용을 포함함을 확인했습니다.</label>
     <label>청구 증빙 ID<Input className={input} name="reference" placeholder="invoice-..." required/></label>
     <label>미확정 처리<Select className={input} name="resolveAllHeld"><option value="false">미확정 유지</option><option value="true">증빙으로 전체 정산</option></Select></label>
     <Button className={button}>청구 대조 기록</Button>
    </form>
   </div>)}
  </section>
  <section className="rounded border p-4"><h2 className="font-bold">90일 삭제 상태</h2>
   <p>하루 1회 실행 기본안 · 만료 원문 즉시 조회 차단 · 만료 backlog {state.expiredCount}건</p>
   <p>작업: {state.retention?.status ?? "미실행"} · 누적 삭제 {state.retention?.deletedCount ?? 0}건</p>
   <form action={retryRetentionAction}><Button className={button}>삭제 작업 재시도</Button></form>
  </section>
  <section className="rounded border p-4"><h2 className="font-bold">유효 상담 기록</h2>
   {state.consultations.length === 0 ? <p>조회 가능한 상담이 없습니다.</p> : <ul>{state.consultations.map(c => <li key={c.id}><Link className="underline" href={"/ai-service/" + c.id}>{c.createdAt.toISOString()} · {c.status}</Link></li>)}</ul>}
  </section>
 </main>;
}
