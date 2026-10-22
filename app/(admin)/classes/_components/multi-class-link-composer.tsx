"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { issueClassApplicationLink } from "@/app/(admin)/reservation-applications/actions";
import { Button } from "@/components/ui/button";
import { CopyControl } from "@/components/application-ux/copy-control";
import { FormFeedback } from "@/components/application-ux/form-feedback";
import type { ClassLinkOperation, ClassLinkReceipt } from "@/server/reservation-applications/groups";
import type { LinkCompositionOption } from "@/lib/reservation-applications/link-queries";

/** Browser memory only. Callers reconcile linkId with the latest active server projection. */
export function IssuedLinkControls({ url, disabled = false, copyFailureMessage }: { url: string; disabled?: boolean; copyFailureMessage?: string }) {
  const [notice, setNotice] = useState<string>();
  return <div className="min-w-0 space-y-2"><p className="text-sm">링크를 발급했습니다. 이 화면을 떠나면 주소를 다시 확인할 수 없습니다. 지금 복사하거나 공유해 주세요.</p><CopyControl disabled={disabled} failureMessage={copyFailureMessage} value={url} /><div className="flex flex-col gap-2 sm:flex-row"><Button disabled={disabled || !url} onClick={async () => {
    if (!navigator.share) { setNotice("공유 기능을 사용할 수 없습니다. 링크를 복사해 전달해 주세요."); return; }
    try { await navigator.share({ title: "예약 신청 링크", url }); setNotice("공유했습니다."); }
    catch (error) { setNotice(error instanceof Error && error.name === "AbortError" ? "공유를 취소했습니다. 링크는 유지됩니다." : "공유하지 못했습니다. 링크를 복사해 전달해 주세요."); }
  }} type="button">공유하기</Button>{url && !disabled ? <a className="inline-flex min-h-11 items-center justify-center rounded border px-4 text-sm" href={url} rel="noopener noreferrer" target="_blank">신청 화면 확인</a> : null}</div><FormFeedback notice={notice} /></div>;
}

export function MultiClassLinkComposer({ options, currentClassId, onIssued }: { options: LinkCompositionOption[]; currentClassId?: string; onIssued?: (receipt: ClassLinkReceipt) => void }) {
  const [selected, setSelected] = useState<string[]>(currentClassId ? [currentClassId] : []);
  const attempt = useRef<ClassLinkOperation | undefined>(undefined);
  const [frozen, setFrozen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const router = useRouter();
  return <form className="space-y-3 rounded border p-3" onSubmit={(event) => {
    event.preventDefault(); setError(undefined);
    if (!attempt.current && selected.length > 100) { setError("한 번에 최대 100개 클래스를 선택해 주세요."); return; }
    if (!attempt.current) attempt.current = { kind: "compose", operationId: crypto.randomUUID(), classScheduleIds: selected, revisions: Object.fromEntries(options.filter((row) => selected.includes(row.id)).map((row) => [row.id, row.revision])) };
    const intent = attempt.current; setFrozen(true);
    startTransition(async () => {
      try {
        const result = await issueClassApplicationLink(intent);
        if (result.error) { setError(result.error); if (result.conflict) { attempt.current = undefined; setFrozen(false); router.refresh(); } return; }
        if (result.groupId) onIssued?.(result as ClassLinkReceipt);
        setNotice(result.replayed ? "발급된 링크를 확인했습니다. 원문 주소는 복원되지 않습니다. 목록의 해당 그룹에서 현재 상태를 확인해 주세요." : "그룹과 신청 링크를 함께 발급했습니다. 원문은 발급 직후 현재 화면에서만 확인할 수 있습니다.");
        attempt.current = undefined; setFrozen(false); router.refresh();
      } catch { setError("결과를 확인하지 못했습니다. 선택을 유지한 같은 작업으로 다시 시도해 주세요."); }
    });
  }}><h3 className="font-medium">여러 클래스 통합 신청</h3><p className="text-sm">선택한 클래스만 새 그룹으로 묶고 첫 링크를 함께 발급합니다. 다른 링크와 과거 신청은 유지됩니다. 한 번에 최대 100개 클래스를 선택할 수 있습니다.</p>{options.map((row) => <label className="flex min-h-11 items-center gap-2 text-sm" key={row.id}><input checked={selected.includes(row.id)} disabled={pending || frozen || !row.eligible || row.id === currentClassId || selected.length >= 100 && !selected.includes(row.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, row.id] : ids.filter((id) => id !== row.id))} type="checkbox" /><span>{row.label} · {row.applicationPrice === null ? "신청금액 미설정" : `${row.applicationPrice.toLocaleString("ko-KR")}원`} · {row.eligible ? "미래 예정 · 금액 준비" : "신규 접수 불가"}</span></label>)}<Button disabled={pending || !selected.length || selected.some((id) => !options.find((row) => row.id === id)?.eligible)} type="submit">{pending ? "발급 중…" : frozen ? "같은 작업 다시 시도" : "선택한 클래스로 새 링크 발급"}</Button><FormFeedback error={error} notice={notice} /></form>;
}
