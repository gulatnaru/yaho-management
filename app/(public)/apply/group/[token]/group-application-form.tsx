"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { APPLICATION_REQUEST_NOTE_GUIDE, APPLICATION_REQUEST_NOTE_MAX_LENGTH } from "@/lib/reservation-applications/constants";
import { openApplicationCompletePage } from "@/lib/reservation-applications/complete-navigation";
import type { GroupSubmissionState } from "./actions";

type Child = { classScheduleId: string; requestedChildId?: string; childName: string; childBirthDate: string; childGender: string; requestNote: string; programTerms: boolean; privacyConsent: boolean; legalGuardianConfirmation: boolean; refundTerms: boolean; photoShareConsent: boolean; photoMarketingConsent: boolean };
type RepeatChild = { id: string; name: string; birthDate: string; gender: string };
type RepeatProfile = { guardian: { guardianName: string; guardianPhone: string; guardianRelationship: string } | null; children: RepeatChild[] };
const blankChild = (classScheduleId = ""): Child => ({ classScheduleId, childName: "", childBirthDate: "", childGender: "UNSPECIFIED", requestNote: "", programTerms: false, privacyConsent: false, legalGuardianConfirmation: false, refundTerms: false, photoShareConsent: false, photoMarketingConsent: false });

export function GroupApplicationForm({ action, classes }: { action: (state: GroupSubmissionState, form: FormData) => Promise<GroupSubmissionState>; classes: Array<{ id: string; label: string }> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [guardian, setGuardian] = useState({ guardianName: "", guardianPhone: "", guardianRelationship: "MOTHER", declaredPayerName: "" });
  const [children, setChildren] = useState<Child[]>([blankChild(classes[0]?.id)]);
  const [repeat, setRepeat] = useState<RepeatProfile>({ guardian: null, children: [] });

  useEffect(() => { if (state.submitted) openApplicationCompletePage(); }, [state.submitted]);
  useEffect(() => {
    void fetch("/api/reservation-applications/repeat-children", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => response.ok ? response.json() as Promise<RepeatProfile> : { guardian: null, children: [] })
      .then((profile) => {
        setRepeat(profile);
        // A device only has a usable profile after an exact DeviceSubmission
        // ownership check. Never merge a shared browser's data by phone.
        if (profile.guardian) setGuardian((current) => ({ ...current, ...profile.guardian }));
      })
      .catch(() => setRepeat({ guardian: null, children: [] }));
  }, []);

  function update(index: number, key: keyof Child, value: string | boolean) {
    setChildren((items) => items.map((item, position) => position === index ? { ...item, [key]: value } : item));
  }
  function chooseRepeatChild(index: number, id: string) {
    const owned = repeat.children.find((item) => item.id === id);
    setChildren((items) => items.map((item, position) => position === index
      ? { ...item, requestedChildId: owned?.id, childName: owned?.name ?? "", childBirthDate: owned?.birthDate ?? "", childGender: owned?.gender ?? "UNSPECIFIED" }
      : item));
  }

  return <form action={formAction} className="space-y-5" onSubmit={(event) => {
    const hidden = event.currentTarget.elements.namedItem("payload") as HTMLInputElement;
    hidden.value = JSON.stringify({ ...guardian, children });
  }}>
    <input name="payload" type="hidden" />
    <fieldset className="space-y-3 rounded border p-4">
      <legend className="px-1 font-semibold">보호자와 입금자</legend>
      {([['guardianName','보호자 이름'],['guardianPhone','보호자 연락처'],['declaredPayerName','입금자명']] as const).map(([key,label]) => <div className="space-y-1" key={key}><Label htmlFor={`application-${key}`}>{label}</Label><Input id={`application-${key}`} onChange={(event) => setGuardian((current) => ({ ...current, [key]: event.target.value }))} required value={guardian[key]} /></div>)}
      <Select aria-label="아이와의 관계" onChange={(event) => setGuardian((current) => ({ ...current, guardianRelationship: event.target.value }))} value={guardian.guardianRelationship}><option value="MOTHER">어머니</option><option value="FATHER">아버지</option><option value="OTHER_LEGAL_GUARDIAN">기타 법정대리인</option></Select>
    </fieldset>
    {children.map((child,index) => {
      const reused = Boolean(child.requestedChildId);
      return <fieldset className="space-y-3 rounded border p-4" key={index}>
        <legend className="px-1 font-semibold">아이 {index + 1}</legend>
        {repeat.children.length > 0 ? <Select aria-label={`아이 ${index + 1} 기존 아이`} onChange={(event) => chooseRepeatChild(index, event.target.value)} value={child.requestedChildId ?? ""}><option value="">새 아이로 신청</option>{repeat.children.map((owned) => <option key={owned.id} value={owned.id}>{owned.name}</option>)}</Select> : null}
        <Select aria-label={`아이 ${index + 1} 클래스`} onChange={(event) => update(index,"classScheduleId",event.target.value)} value={child.classScheduleId}>{classes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
        {([['childName','아이 이름','text'],['childBirthDate','생년월일','date']] as const).map(([key,label,type]) => <div className="space-y-1" key={key}><Label htmlFor={`application-child-${index}-${key}`}>{label}</Label><Input id={`application-child-${index}-${key}`} onChange={(event) => update(index,key,event.target.value)} readOnly={reused} required type={type} value={child[key]} /></div>)}
        <Select aria-label={`아이 ${index + 1} 성별`} disabled={reused} onChange={(event) => update(index,"childGender",event.target.value)} value={child.childGender}><option value="UNSPECIFIED">선택 안 함</option><option value="FEMALE">여아</option><option value="MALE">남아</option></Select>
        <div className="space-y-1"><Label htmlFor={`application-child-${index}-request-note`}>요청사항</Label><p className="text-xs text-slate-500" id={`application-child-${index}-request-note-guide`}>{APPLICATION_REQUEST_NOTE_GUIDE}</p><Textarea aria-describedby={`application-child-${index}-request-note-guide`} id={`application-child-${index}-request-note`} maxLength={APPLICATION_REQUEST_NOTE_MAX_LENGTH} onChange={(event) => update(index,"requestNote",event.target.value)} value={child.requestNote} /></div>
        <div className="space-y-2" data-testid="application-consents">
          {APPLICATION_CONSENT_CONTENT.items.map((item) => <div className="rounded border p-3" key={item.key}>
            <details><summary className="cursor-pointer font-medium">{item.required ? "[필수]" : "[선택]"} {item.title}</summary><div className="mt-2 space-y-1 text-xs text-slate-600">{item.body.map((line) => <p key={line}>{line}</p>)}</div></details>
            <label className="mt-2 flex gap-2 text-sm"><input checked={child[item.key]} onChange={(event) => update(index,item.key,event.target.checked)} type="checkbox" />{item.checkLabel}</label>
          </div>)}
          <p className="text-xs text-slate-500">동의 문구 버전: {APPLICATION_CONSENT_CONTENT.version}. 아이마다 현재 동의를 새로 확인합니다.</p>
        </div>
        {children.length > 1 ? <Button onClick={() => setChildren((items) => items.filter((_, position) => position !== index))} type="button">이 아이 삭제</Button> : null}
      </fieldset>;
    })}
    <Button onClick={() => setChildren((items) => [...items, blankChild(classes[0]?.id)])} type="button">아이 추가</Button>
    <input aria-hidden="true" className="hidden" name="website" tabIndex={-1} />
    <p className="text-xs text-slate-500">신청 완료 후에는 입금 안내를 확인할 수 있습니다.</p>
    {state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}
    <Button className="w-full" disabled={pending || state.submitted} type="submit">{pending ? "신청 중..." : "신청하기"}</Button>
  </form>;
}
