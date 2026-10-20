"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveApplicationPrice } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormFeedback } from "@/components/application-ux/form-feedback";

export function ApplicationPriceForm({ classScheduleId, price, revision, disabled }: { classScheduleId: string; price: number | null; revision: string; disabled: boolean }) {
  const [draftRevision, setDraftRevision] = useState(revision);
  const [value, setValue] = useState(price?.toString() ?? "");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <form className="space-y-2" onSubmit={(event) => {
    event.preventDefault(); setError(undefined); setNotice(undefined);
    startTransition(async () => {
      try {
        const result = await saveApplicationPrice({ classScheduleId, revision: draftRevision, applicationPrice: Number(value) });
        if (result.error) setError(result.error);
        else { if (result.revision) setDraftRevision(result.revision); setNotice("신청금액을 저장했습니다."); router.refresh(); }
      } catch { setError("저장 결과를 확인하지 못했습니다. 다시 불러와 현재 가격을 확인해 주세요."); }
    });
  }}><label className="block text-sm" htmlFor={`application-price-${classScheduleId}`}>신청금액 설정 (원)</label><div className="flex flex-wrap gap-2"><Input className="max-w-48" disabled={disabled || pending} id={`application-price-${classScheduleId}`} inputMode="numeric" min="1" onChange={(event) => setValue(event.target.value)} required step="1" type="number" value={value} /><Button disabled={disabled || pending || !revision} type="submit">{pending ? "저장 중…" : "신청금액 저장"}</Button></div><FormFeedback error={error} notice={notice} />{error || revision !== draftRevision ? <Button onClick={() => { setValue(price?.toString() ?? ""); setDraftRevision(revision); setError(undefined); router.refresh(); }} type="button">현재 가격 다시 불러오기</Button> : null}</form>;
}
