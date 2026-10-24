"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { IssuedLinkControls, MultiClassLinkComposer } from "@/app/(admin)/classes/_components/multi-class-link-composer";
import type { LinkCompositionOption } from "@/lib/reservation-applications/link-queries";
import type { ClassLinkReceipt } from "@/server/reservation-applications/groups";
import { readGroupLinkProjection } from "@/app/(admin)/classes/link-projection-actions";
import { FormFeedback } from "@/components/application-ux/form-feedback";

export function GroupCreateForm({ classes, activeLinkIds }: { classes: LinkCompositionOption[]; activeLinkIds: string[] }) {
  const [receipt, setReceipt] = useState<ClassLinkReceipt>();
  const source = useRef({ activeLinkIds, classes });
  useLayoutEffect(() => { source.current = { activeLinkIds, classes }; }, [activeLinkIds, classes]);
  const request = useRef(0);
  const [projection, setProjection] = useState<{ source: typeof source.current } & Awaited<ReturnType<typeof readGroupLinkProjection>>>();
  const [error, setError] = useState<string>();
  async function onIssued(nextReceipt: ClassLinkReceipt) {
    setReceipt(nextReceipt); setError(undefined);
    const requestedSource = source.current;
    const requested = ++request.current;
    try {
      const data = await readGroupLinkProjection(nextReceipt.groupId);
      if (requestedSource === source.current && requested === request.current && data.groupId === nextReceipt.groupId) setProjection((previous) => ({ source: requestedSource, ...data, members: { ...(previous?.source === requestedSource ? previous.members : {}), ...data.members } }));
    } catch {
      if (requestedSource === source.current && requested === request.current) setError("발급은 완료했지만 현재 링크 상태를 확인하지 못했습니다. 다시 불러와 확인해 주세요.");
    }
  }
  const matchingProjection = projection?.source.activeLinkIds === activeLinkIds && projection.source.classes === classes ? projection : undefined;
  const current = matchingProjection?.groupId === receipt?.groupId ? matchingProjection : undefined;
  const currentIds = current ? current.activeLinkIds : activeLinkIds;
  const currentClasses = matchingProjection ? classes.map((row) => ({ ...row, ...matchingProjection.members[row.id] })) : classes;
  const url = receipt?.token && receipt.linkId && currentIds.includes(receipt.linkId) ? `${window.location.origin}/apply/group/${receipt.token}` : "";
  return <div className="space-y-3"><MultiClassLinkComposer onIssued={onIssued} options={currentClasses} />{url ? <IssuedLinkControls url={url} /> : null}<FormFeedback error={error} /></div>;
}
