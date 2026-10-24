"use client";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

export type LinkIntent = "replace" | "stop" | "resume" | "upgrade";
const COPY: Record<LinkIntent, { title: string; body: string; action: string }> = {
  replace: { title: "링크를 교체할까요?", body: "기존 링크가 무효화됩니다. 기존 신청·예약·입금·환불 기록은 유지됩니다. 새 주소 재공유 필요: 공유한 곳에 새 주소를 다시 안내해 주세요.", action: "기존 링크를 무효화하고 재발급" },
  stop: { title: "신청 접수를 중지할까요?", body: "이 링크의 신규 신청만 중지합니다. 기존 신청·예약·입금·환불 기록은 유지됩니다.", action: "신청 접수 중지" },
  resume: { title: "새 링크로 접수를 재개할까요?", body: "새 주소로 접수를 재개합니다. 이전 주소는 사용할 수 없습니다. 새 주소 재공유 필요. 기존 신청과 예약은 유지됩니다.", action: "새 링크로 접수 재개" },
  upgrade: { title: "기존 주소를 새 신청 방식으로 전환할까요?", body: "주소를 유지하는 명시 전환이며 링크 교체와 다릅니다. 가격과 동의 문구를 먼저 확인해 주세요. 이후 신청부터 현재 지정 금액과 새 동의가 적용됩니다. 과거 신청 금액과 기록은 바뀌지 않습니다.", action: "기존 주소를 유지하고 전환" },
};
export function LinkImpactConfirmation({ intent, members, pending, onConfirm, onCancel }: { intent: LinkIntent; members: { id: string; label: string }[]; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  const copy = COPY[intent];
  return <dialog aria-labelledby="link-impact-title" className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg p-5 backdrop:bg-black/40" onCancel={(event) => { event.preventDefault(); if (!pending) onCancel(); }} ref={dialog}><h2 className="font-semibold" id="link-impact-title">{copy.title}</h2><p className="my-3 text-sm">{copy.body}</p><p>대상 클래스 전체</p><ul className="my-3 space-y-2">{members.map((member) => <li className="break-words text-sm" key={member.id}>{member.label}</li>)}</ul><div className="flex flex-col gap-2 sm:flex-row"><Button autoFocus disabled={pending} onClick={onCancel} type="button">취소</Button><Button disabled={pending} onClick={onConfirm} type="button">{pending ? "처리 중…" : copy.action}</Button></div></dialog>;
}
