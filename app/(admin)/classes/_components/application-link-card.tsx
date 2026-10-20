"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { issueApplicationLink, issueClassApplicationLink, stopApplicationLink, upgradeLegacyApplicationLink } from "@/app/(admin)/reservation-applications/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyControl } from "@/components/application-ux/copy-control";
import { FormFeedback } from "@/components/application-ux/form-feedback";
import type { ClassLinkOperation, ClassLinkReceipt } from "@/server/reservation-applications/groups";
import { familyListHref } from "@/lib/reservation-applications/navigation";
import { ApplicationPriceForm } from "./application-price-form";
import { IssuedLinkControls, MultiClassLinkComposer } from "./multi-class-link-composer";
import { LinkImpactConfirmation, type LinkIntent } from "./link-impact-confirmation";
import { GroupLinkButton } from "@/app/(admin)/reservation-applications/groups/group-link-button";
import type { LinkCompositionOption } from "@/lib/reservation-applications/link-queries";
import type { ClassApplicationLinksView } from "@/lib/reservation-applications/link-queries";
import { LinkScopeList } from "./link-scope-list";
import { LinkReadiness, LinkReadinessIssues } from "./link-readiness";

export function ApplicationLinkCard({ view, classScheduleId, options }: { view: ClassApplicationLinksView | null; classScheduleId: string; options?: LinkCompositionOption[] | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [origin, setOrigin] = useState("");
  const router = useRouter();
  const [receipt, setReceipt] = useState<ClassLinkReceipt>();
  const [legacyIntent, setLegacyIntent] = useState<{ kind: LinkIntent; revision: string }>();
  const [legacyUnresolved, setLegacyUnresolved] = useState(false);
  const [legacyRefresh, setLegacyRefresh] = useState<{ kind: LinkIntent; revision: string }>();
  const legacyAttempt = useRef<{ kind: LinkIntent; revision: string } | undefined>(undefined);
  const attempt = useRef<ClassLinkOperation | undefined>(undefined);
  const [unresolved, setUnresolved] = useState(false);
  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [router]);
  useEffect(() => { setOrigin(window.location.origin); }, []);

  if (!view) return <Card data-testid="application-link-card"><CardHeader><CardTitle>이 클래스 신청 링크</CardTitle></CardHeader><CardContent>
    <p role="alert">링크 정보를 불러오지 못했습니다.</p>
    {legacyRefresh?.kind === "replace" ? <p>기존 방식으로 재발급된 주소는 클래스 상세에서 다시 확인할 수 있습니다. 다시 불러와 현재 주소를 확인해 주세요.</p> : null}
    <Button onClick={() => { if (legacyRefresh) window.location.reload(); else router.refresh(); }} type="button">다시 불러오기</Button>
  </CardContent></Card>;

  const currentScopes = view.scopes.filter((scope) => scope.currentClassMember);
  const directHistory = view.scopes.find((scope) => scope.id === `class:${classScheduleId}`);
  const direct = currentScopes.find((scope) => scope.id === `class:${classScheduleId}`);
  const active = currentScopes.some((scope) => scope.activeForCurrentClass);
  const issued = currentScopes.some((scope) => scope.links.length > 0);
  const legacyRefreshPending = Boolean(legacyRefresh && legacyRefresh.revision === view.revision);
  const rawLinks = currentScopes.filter((scope) => scope.activeForCurrentClass && !(legacyRefreshPending && scope.id === `class:${classScheduleId}`)).flatMap((scope) => scope.links.filter((link) => link.rawPath).map((link) => ({ ...link, scopeLabel: scope.label })));
  const canIssueLegacy = view.canIssue && !directHistory?.upgraded;
  const receiptCurrent = receipt?.linkId && currentScopes.some((scope) => scope.activeForCurrentClass && scope.links.some((link) => link.id === receipt.linkId && link.isActive));
  const currentUrl = receipt?.token && receiptCurrent && origin ? `${origin}/apply/group/${receipt.token}` : "";
  function issueSingle() {
    if (!view?.revision) return;
    if (!attempt.current) attempt.current = { kind: "single", operationId: crypto.randomUUID(), classScheduleIds: [classScheduleId], revisions: { [classScheduleId]: view.revision } };
    const request = attempt.current; setError(undefined); setUnresolved(true);
    startTransition(async () => {
      try {
        const result = await issueClassApplicationLink(request);
        if (result.error) { setError(result.error); if (result.conflict) { attempt.current = undefined; setUnresolved(false); router.refresh(); } return; }
        setReceipt(result as ClassLinkReceipt); setNotice(result.replayed ? "발급된 링크를 확인했습니다. 원문 주소는 복원되지 않습니다." : "신청 링크를 발급했습니다.");
        attempt.current = undefined; setUnresolved(false); router.refresh();
      } catch { setError("결과를 확인하지 못했습니다. 같은 작업으로 다시 시도해 주세요. 기존 유효 링크는 유지됩니다."); }
    });
  }
  function runLegacy(confirmed: { kind: LinkIntent; revision: string }) {
    legacyAttempt.current ??= confirmed;
    setLegacyUnresolved(true);
    const request = legacyAttempt.current;
    setError(undefined); setNotice(undefined);
    startTransition(async () => {
      try {
        const result = await (request.kind === "stop" ? stopApplicationLink(classScheduleId, request.revision) : request.kind === "replace" ? issueApplicationLink(classScheduleId, request.revision) : upgradeLegacyApplicationLink(classScheduleId, request.revision));
        legacyAttempt.current = undefined; setLegacyUnresolved(false);
        // Even an error can follow a committed mutation when path revalidation fails.
        // Never keep offering the address from before that operation as current.
        setLegacyRefresh(request);
        if (result.error) setError(result.error); else {
          setNotice(request.kind === "replace" ? "기존 주소를 무효화하고 재발급했습니다. 새 주소는 클래스 상세에서 다시 확인할 수 있습니다. 현재 주소가 보이지 않으면 다시 불러와 주세요." : "처리했습니다.");
        }
        router.refresh();
      } catch {
        setLegacyRefresh(request);
        setError(`처리 결과를 확인하지 못했습니다. ${request.kind === "replace" ? "기존 방식으로 재발급된 주소는 클래스 상세에서 다시 확인할 수 있습니다. " : ""}다시 불러와 현재 링크 상태를 확인해 주세요. 같은 작업 재시도는 최초 상태로만 확인합니다.`);
        router.refresh();
      }
    });
  }
  return <Card data-testid="application-link-card">
    <CardHeader><CardTitle>이 클래스 신청 링크</CardTitle></CardHeader>
    <CardContent className="min-w-0 space-y-3">
      <p className="break-words font-medium">{view.className} · {view.timeLabel}</p>
      <p>참가비: {view.applicationPrice === null ? "미설정" : `${view.applicationPrice.toLocaleString("ko-KR")}원`}</p>
      {view.priceRevision ? <ApplicationPriceForm key={classScheduleId} classScheduleId={classScheduleId} disabled={!view.canIssue || pending} price={view.applicationPrice} revision={view.priceRevision} /> : null}
      <p>링크 상태: {active ? "링크 활성" : issued ? "링크 비활성 · 접수 중지" : view.scopes.length > 0 ? "이 클래스에 해당하는 링크 없음" : "미발급"} <span className="rounded bg-slate-100 px-2 py-1 text-xs">{view.environment}</span></p>
      {!view.publicAccessAllowed ? <p className="text-sm">{view.environment === "Preview" ? "변경한 화면을 미리 확인하는 테스트 환경입니다. 여기서는 일반 보호자 신청을 받지 않습니다. 실제 보호자에게 보낼 링크는 운영 환경에서 확인해 주세요." : "현재 환경에서는 일반 보호자 신청을 받지 않습니다."} 링크 중지와는 별개이며 운영 환경의 접수 상태는 여기서 확인할 수 없습니다.</p> : null}
      {!view.canIssue ? <p className="text-sm">클래스 상태로 신규 접수 불가 · 기존 신청과 예약은 유지됩니다.</p> : null}
      {currentScopes.length === 0 ? <LinkReadinessIssues classScheduleId={classScheduleId} readiness={view.unissuedReadiness} /> : null}
      {currentScopes.filter((scope) => scope.readiness.issuance === "STOPPED" || scope.readiness.classIntake !== "READY" || !scope.readiness.guideReady || !scope.readiness.consentReady || scope.readiness.accessRestriction === "SYNTHETIC").map((scope) => <div className="rounded border p-2" key={scope.id}><p className="break-words text-sm font-medium">{scope.label} · {scope.members.map((member) => member.label).join(" / ")}</p><LinkReadinessIssues classScheduleId={classScheduleId} readiness={scope.readiness} /></div>)}
      {legacyRefreshPending ? <div className="space-y-2"><p className="text-sm">현재 링크 상태와 주소를 다시 확인해야 합니다.{legacyRefresh?.kind === "replace" ? " 기존 방식으로 재발급된 주소는 클래스 상세에서 다시 확인할 수 있습니다." : ""}</p><Button disabled={pending} onClick={() => window.location.reload()} type="button">현재 링크 다시 불러오기</Button></div> : null}
      {active && rawLinks.length === 0 && !currentUrl && !legacyRefreshPending ? <p className="text-sm">활성 상태로 발급된 링크가 있습니다. 주소는 발급할 때만 확인할 수 있습니다. 새 주소가 필요하면 고급 설정에서 해당 범위의 링크 교체를 확인해 주세요.</p> : null}
      {!issued && view.canIssue ? <><p className="text-sm">주소는 발급 직후 현재 화면에서만 확인할 수 있습니다. 화면을 떠나기 전에 복사하거나 공유해 주세요.</p><Button className="min-h-11 w-full md:w-auto" disabled={pending || !view.revision || !view.applicationPrice || !view.unissuedReadiness.consentReady} onClick={issueSingle} type="button">{pending ? "링크 발급 중…" : unresolved ? "같은 작업 다시 시도" : "신청 링크 발급"}</Button></> : null}
      {unresolved && issued ? <Button disabled={pending} onClick={issueSingle} type="button">같은 작업 결과 확인</Button> : null}
      {currentUrl ? <IssuedLinkControls disabled={pending} url={currentUrl} /> : null}
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
      {legacyUnresolved ? <Button disabled={pending} onClick={() => { if (legacyAttempt.current) runLegacy(legacyAttempt.current); }} type="button">같은 기존 링크 작업 결과 확인</Button> : null}
      <FormFeedback error={error} notice={notice} />
      <Link className="inline-block min-h-11 py-2 text-sm underline" href={familyListHref({ classScheduleId })}>이 클래스 신청 보기</Link>
      <Link className="inline-block min-h-11 py-2 text-sm underline" href="/reservation-applications">신청 목록 보기 · 전체 클래스</Link>
      <details><summary className="min-h-11 cursor-pointer py-2 font-medium">고급 설정 펼치기</summary>
        <div className="space-y-4 pt-2">
          <LinkScopeList scopes={view.scopes} />
          {view.scopes.length === 0 ? <LinkReadiness readiness={view.unissuedReadiness} /> : null}
          {direct && canIssueLegacy ? <div className="space-y-2">
            {direct.readiness.issuance === "ACTIVE" ? <Button disabled={pending || legacyUnresolved || legacyRefreshPending || !view.revision} onClick={() => setLegacyIntent({ kind: "stop", revision: view.revision! })} type="button">신청 접수 중지</Button> : null}
            <Button disabled={pending || legacyUnresolved || legacyRefreshPending || !view.revision} onClick={() => setLegacyIntent({ kind: "replace", revision: view.revision! })} type="button">기존 주소 무효화 후 재발급</Button>
            <Button disabled={pending || legacyUnresolved || legacyRefreshPending || !view.revision || !view.applicationPrice || !view.unissuedReadiness.consentReady} onClick={() => setLegacyIntent({ kind: "upgrade", revision: view.revision! })} type="button">기존 주소를 유지하고 새 방식으로 전환</Button>
            <p className="text-sm">기존 금액 없는 주소는 명시 전환 전까지 유지됩니다. 가격을 저장해도 기존 신청의 금액은 바뀌지 않습니다.</p>
          </div> : null}
          {currentScopes.filter((scope) => scope.groupId).map((scope) => <div className="space-y-2 rounded border p-3" key={scope.id}><p>{scope.label}</p><GroupLinkButton activeLinkIds={scope.links.filter((link) => link.isActive).map((link) => link.id)} groupId={scope.groupId!} hasLinks={scope.links.length > 0} isActive={scope.scopeActive && scope.links.some((link) => link.isActive)} members={scope.members} onIssued={setReceipt} revision={scope.revision} revisions={Object.fromEntries(scope.members.map((member) => [member.id, member.revision ?? (member.id === classScheduleId ? view.revision ?? "" : options?.find((row) => row.id === member.id)?.revision ?? "")]))} /></div>)}
          {options ? <MultiClassLinkComposer currentClassId={classScheduleId} onIssued={setReceipt} options={options} /> : <p role="alert">선택 가능한 클래스 정보를 불러오지 못했습니다. 다시 불러와 주세요.</p>}
          <Link className="inline-block min-h-11 py-2 text-sm underline" href="/reservation-applications/groups">여러 클래스 통합 신청 관리</Link>
          <p className="text-sm text-slate-600">새 방식 주소는 해시만 저장하므로 원문을 복원할 수 없습니다. 기존 방식 주소는 호환 범위에서 표시합니다. 링크 열어보기는 현재 환경의 일반 공개 화면을 새 탭에서 확인하며 신청을 제출하지 않습니다.</p>
        </div>
      </details>
      {legacyIntent && direct ? <LinkImpactConfirmation intent={legacyIntent.kind} members={direct.members} onCancel={() => setLegacyIntent(undefined)} onConfirm={() => { const request = legacyIntent; setLegacyIntent(undefined); runLegacy(request); }} pending={pending} /> : null}
    </CardContent>
  </Card>;
}
