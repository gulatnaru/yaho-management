"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { issueApplicationLink, stopApplicationLink, upgradeLegacyApplicationLink } from "@/app/(admin)/reservation-applications/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyControl } from "@/components/application-ux/copy-control";
import { FormFeedback } from "@/components/application-ux/form-feedback";
import type { ClassApplicationLinksView } from "@/lib/reservation-applications/link-queries";
import { LinkScopeList } from "./link-scope-list";
import { LinkReadiness, LinkReadinessIssues } from "./link-readiness";

export function ApplicationLinkCard({ view, classScheduleId }: { view: ClassApplicationLinksView | null; classScheduleId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [origin, setOrigin] = useState("");
  const router = useRouter();
  useEffect(() => { setOrigin(window.location.origin); }, []);

  if (!view) return <Card data-testid="application-link-card"><CardHeader><CardTitle>이 클래스 신청 링크</CardTitle></CardHeader><CardContent>
    <p role="alert">링크 정보를 불러오지 못했습니다.</p><Button onClick={() => router.refresh()} type="button">다시 불러오기</Button>
  </CardContent></Card>;

  const direct = view.scopes.find((scope) => scope.id === `class:${classScheduleId}`);
  const active = view.scopes.some((scope) => scope.readiness.issuance === "ACTIVE");
  const issued = view.scopes.some((scope) => scope.links.length > 0);
  const rawLinks = view.scopes.flatMap((scope) => scope.links.filter((link) => link.rawPath).map((link) => ({ ...link, scopeLabel: scope.label })));
  const canIssueLegacy = view.canIssue && !direct?.upgraded;
  function run(action: () => Promise<{ error?: string }>, confirmation?: string) {
    if (confirmation && !window.confirm(confirmation)) return;
    setError(undefined); setNotice(undefined);
    startTransition(async () => {
      try { const result = await action(); if (result.error) setError(result.error); else { setNotice("처리했습니다."); router.refresh(); } }
      catch { setError("처리 결과를 확인하지 못했습니다. 다시 불러와 현재 링크 상태를 확인해 주세요."); }
    });
  }
  return <Card data-testid="application-link-card">
    <CardHeader><CardTitle>이 클래스 신청 링크</CardTitle></CardHeader>
    <CardContent className="min-w-0 space-y-3">
      <p className="break-words font-medium">{view.className} · {view.timeLabel}</p>
      <p>참가비: {view.applicationPrice === null ? "미설정" : `${view.applicationPrice.toLocaleString("ko-KR")}원`}</p>
      <p>링크 상태: {active ? "링크 활성" : issued ? "링크 비활성 · 접수 중지" : "미발급"} <span className="rounded bg-slate-100 px-2 py-1 text-xs">{view.environment}</span></p>
      {!view.publicAccessAllowed ? <p className="text-sm">{view.environment === "Preview" ? "변경한 화면을 미리 확인하는 테스트 환경입니다. 여기서는 일반 보호자 신청을 받지 않습니다. 실제 보호자에게 보낼 링크는 운영 환경에서 확인해 주세요." : "현재 환경에서는 일반 보호자 신청을 받지 않습니다."} 링크 중지와는 별개이며 운영 환경의 접수 상태는 여기서 확인할 수 없습니다.</p> : null}
      {!view.canIssue ? <p className="text-sm">클래스 상태로 신규 접수 불가 · 기존 신청과 예약은 유지됩니다.</p> : null}
      {view.scopes.length === 0 ? <LinkReadinessIssues classScheduleId={classScheduleId} readiness={view.unissuedReadiness} /> : null}
      {view.scopes.filter((scope) => scope.readiness.issuance === "STOPPED" || scope.readiness.classIntake !== "READY" || !scope.readiness.guideReady || !scope.readiness.consentReady || scope.readiness.accessRestriction === "SYNTHETIC").map((scope) => <div className="rounded border p-2" key={scope.id}><p className="break-words text-sm font-medium">{scope.label} · {scope.members.map((member) => member.label).join(" / ")}</p><LinkReadinessIssues classScheduleId={classScheduleId} readiness={scope.readiness} /></div>)}
      {active && rawLinks.length === 0 ? <p className="text-sm">활성 상태로 발급된 링크가 있습니다. 주소는 발급할 때만 확인할 수 있습니다. 새 주소가 필요하면 고급 설정에서 해당 범위의 링크 교체를 확인해 주세요.</p> : null}
      {!issued && view.scopes.length === 0 && canIssueLegacy ? <Button className="min-h-11 w-full md:w-auto" disabled={pending} onClick={() => run(() => issueApplicationLink(classScheduleId))} type="button">{pending ? "처리 중..." : "링크 발급"}</Button> : null}
      {rawLinks.map((link) => { const url = origin ? `${origin}${link.rawPath}` : ""; return <div className="min-w-0 space-y-2" key={link.id}>
        <p className="text-sm">{link.scopeLabel}</p>
        <CopyControl disabled={pending} value={url} />
        <div className="flex flex-col gap-2 md:flex-row">
          <Button className="min-h-11 bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100" disabled={!url || pending} onClick={async () => {
            setError(undefined); setNotice(undefined);
            if (!navigator.share) { setNotice("공유 기능을 사용할 수 없습니다. 링크를 복사해 전달해 주세요."); return; }
            try { await navigator.share({ title: "예약 신청 링크", url }); }
            catch (cause) { if (!(cause instanceof Error && cause.name === "AbortError")) setError("공유하지 못했습니다. 링크를 복사해 전달해 주세요."); }
          }} type="button">공유하기</Button>
          {url ? <a className="inline-flex min-h-11 items-center justify-center rounded border px-4 text-sm" href={url} rel="noopener noreferrer" target="_blank">신청 화면 확인</a> : null}
        </div>
      </div>; })}
      <FormFeedback error={error} notice={notice} />
      <Link className="inline-block min-h-11 py-2 text-sm underline" href="/reservation-applications">신청 목록 보기 · 전체 클래스</Link>
      <details><summary className="min-h-11 cursor-pointer py-2 font-medium">고급 설정 펼치기</summary>
        <div className="space-y-4 pt-2">
          <LinkScopeList scopes={view.scopes} />
          {view.scopes.length === 0 ? <LinkReadiness readiness={view.unissuedReadiness} /> : null}
          {direct && canIssueLegacy ? <div className="flex flex-col gap-2 md:flex-row">
            <Button disabled={pending} onClick={() => run(() => issueApplicationLink(classScheduleId), "이 클래스의 기존 주소가 무효화됩니다. 이미 접수된 신청은 유지됩니다. 공유한 곳에 새 주소를 다시 안내해 주세요. 링크를 교체할까요?")} type="button">{direct.readiness.issuance === "STOPPED" ? "접수 재개 및 새 링크 발급" : "링크 교체"}</Button>
            {direct.readiness.issuance === "ACTIVE" ? <Button disabled={pending} onClick={() => run(() => stopApplicationLink(classScheduleId), "이 클래스 링크의 신규 신청을 중지합니다. 이미 접수된 신청과 예약은 유지됩니다. 중지할까요?")} type="button">신청 접수 중지</Button> : null}
            {view.applicationPrice !== null && view.applicationPrice > 0 ? <Button disabled={pending} onClick={() => run(() => upgradeLegacyApplicationLink(classScheduleId), "기존 주소는 유지하고 이 클래스의 그룹 신청 방식으로 명시 전환합니다. 계속할까요?")} type="button">기존 주소를 그룹 신청으로 전환</Button> : null}
          </div> : null}
          <Link className="inline-block min-h-11 py-2 text-sm underline" href="/reservation-applications/groups">여러 클래스 통합 신청 관리</Link>
          <p className="text-sm text-slate-600">새 방식 주소는 해시만 저장하므로 원문을 복원할 수 없습니다. 기존 방식 주소는 호환 범위에서 표시합니다. 링크 열어보기는 현재 환경의 일반 공개 화면을 새 탭에서 확인하며 신청을 제출하지 않습니다.</p>
        </div>
      </details>
    </CardContent>
  </Card>;
}
