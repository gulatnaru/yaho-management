"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { issueClassApplicationLink } from "../actions";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/application-ux/form-feedback";
import { LinkImpactConfirmation, type LinkIntent } from "@/app/(admin)/classes/_components/link-impact-confirmation";
import { IssuedLinkControls } from "@/app/(admin)/classes/_components/multi-class-link-composer";
import type { ClassLinkOperation, ClassLinkReceipt } from "@/server/reservation-applications/groups";

export function GroupLinkButton({ groupId, isActive, revision, members = [], revisions = {}, activeLinkIds = [], hasLinks = false, onIssued }: { groupId: string; isActive: boolean; revision?: string; members?: { id: string; label: string }[]; revisions?: Record<string, string>; activeLinkIds?: string[]; hasLinks?: boolean; onIssued?: (receipt: ClassLinkReceipt) => void | Promise<void> }) {
  const [pending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<ClassLinkReceipt>();
  const [intent, setIntent] = useState<LinkIntent>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const attempt = useRef<ClassLinkOperation | undefined>(undefined);
  const router = useRouter();
  const canOperate = Boolean(revision && members.length && members.every((member) => revisions[member.id]));
  function run(kind: "issue" | "replace" | "resume" | "stop") {
    if (!canOperate) return;
    if (!attempt.current) attempt.current = { kind, operationId: crypto.randomUUID(), groupId, classScheduleIds: members.map((member) => member.id), revisions, groupRevision: revision };
    const request = attempt.current; setError(undefined);
    startTransition(async () => {
      try {
        const result = await issueClassApplicationLink(request);
        if (result.error) { setError(result.error); if (result.conflict) { attempt.current = undefined; setIntent(undefined); router.refresh(); } return; }
        if (result.groupId) setReceipt(result as ClassLinkReceipt);
        setNotice(result.replayed ? "처리된 링크를 확인했습니다. 원문 주소는 복원되지 않습니다." : request.kind === "stop" ? "이 링크의 신규 신청을 중지했습니다." : "새 링크를 발급했습니다. 새 주소를 다시 공유해 주세요.");
        attempt.current = undefined; setIntent(undefined);
        if (result.groupId && onIssued) await onIssued(result as ClassLinkReceipt);
        else router.refresh();
      } catch { setError("결과를 확인하지 못했습니다. 같은 작업으로 다시 시도해 주세요."); }
    });
  }
  const url = receipt?.token && receipt.linkId && activeLinkIds.includes(receipt.linkId) ? `${window.location.origin}/apply/group/${receipt.token}` : "";
  return <div className="space-y-2"><div className="flex flex-wrap gap-2"><Button disabled={pending || !canOperate || Boolean(attempt.current)} onClick={() => hasLinks ? setIntent(isActive ? "replace" : "resume") : run("issue")} type="button">{hasLinks ? isActive ? "링크 교체" : "접수 재개 및 새 링크 발급" : "신청 링크 발급"}</Button><Button disabled={!isActive || pending || !canOperate || Boolean(attempt.current)} onClick={() => setIntent("stop")} type="button">신청 접수 중지</Button></div>{error && attempt.current ? <Button disabled={pending} onClick={() => run(attempt.current!.kind as "issue" | "replace" | "resume" | "stop")} type="button">같은 작업 다시 시도</Button> : null}{url && !onIssued ? <IssuedLinkControls url={url} /> : null}<FormFeedback error={error} notice={notice} />{intent ? <LinkImpactConfirmation intent={intent} members={members} onCancel={() => setIntent(undefined)} onConfirm={() => run(intent as "replace" | "resume" | "stop")} pending={pending} /> : null}</div>;
}
