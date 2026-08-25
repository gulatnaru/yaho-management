"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { recordChildConsent, type ConsentFormState } from "@/lib/children/consent/actions";

export function ConsentForm({ childId }: { childId: string }) {
  const [state, action, pending] = useActionState(recordChildConsent.bind(null, childId), {} as ConsentFormState);
  return (
    <form action={action} className="space-y-3 rounded-md border bg-slate-50 p-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <select className="rounded-md border bg-white px-3 py-2 text-sm" defaultValue="PRIVACY" name="consentType">
          <option value="PRIVACY">개인정보 수집·이용</option>
          <option value="SENSITIVE_INFO">민감정보 수집</option>
          <option value="PHOTO_SHARE">활동 사진 공유</option>
          <option value="PHOTO_MARKETING">사진 홍보·마케팅</option>
        </select>
        <select className="rounded-md border bg-white px-3 py-2 text-sm" defaultValue="AGREED" name="action">
          <option value="AGREED">동의</option>
          <option value="REVOKED">철회</option>
        </select>
      </div>
      <input className="w-full rounded-md border bg-white px-3 py-2 text-sm" name="memo" placeholder="메모 (선택)" />
      {state.errors ? <p className="text-sm text-red-600" role="alert">입력값을 확인해 주세요.</p> : null}
      {state.formError ? <p className="text-sm text-red-600" role="alert">{state.formError}</p> : null}
      {state.success ? <p className="text-sm text-emerald-700" role="status">동의 이력을 기록했습니다.</p> : null}
      <Button disabled={pending} type="submit">{pending ? "기록 중..." : "이력 기록"}</Button>
    </form>
  );
}
