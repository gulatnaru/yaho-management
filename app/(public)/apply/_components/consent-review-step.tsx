import type { ApplicationConsentItem } from "@/lib/reservation-applications/consent-content";
import { isRequiredConfirmation, type ChildDraft, type RequiredConfirmations, type RequiredConfirmation, type WizardClass } from "@/lib/reservation-applications/application-draft";
import type { DraftErrors } from "./child-draft-card";
export function ConsentReviewStep({ drafts: children, classes, items, version, required, errors, updateRequired, updateOptional }: {
  drafts: ChildDraft[]; classes: WizardClass[]; items: ApplicationConsentItem[]; version: string; required: RequiredConfirmations; errors: DraftErrors;
  updateRequired: (key: RequiredConfirmation, value: boolean) => void; updateOptional: (id: string, key: "photoShareConsent" | "photoMarketingConsent", value: boolean) => void;
}) {
  function consent(item: ApplicationConsentItem, child?: ChildDraft, index?: number) {
    const common = isRequiredConfirmation(item.key);
    const id = common ? `application-${item.key}` : `application-${child!.draftId}-${item.key}`;
    const error = common ? errors[item.key] || children.map((_, i) => errors[`children.${i}.${item.key}`]).find(Boolean) : errors[`children.${index}.${item.key}`];
    const checked = common ? required[item.key as RequiredConfirmation] : child![item.key as "photoShareConsent" | "photoMarketingConsent"];
    return <div className="space-y-2 rounded border p-3" key={id}>
      <p className="text-sm font-semibold">{item.required ? "[필수]" : "[선택]"} {item.title}</p>
      <details><summary className="flex min-h-11 cursor-pointer items-center text-sm underline">내용 보기</summary><div className="space-y-2 break-words text-sm leading-relaxed">{item.body.map((line) => <p key={line}>{line}</p>)}</div></details>
      <label className="flex min-h-11 items-start gap-3 text-sm" htmlFor={id}><input aria-describedby={error ? `${id}-error` : undefined} aria-invalid={Boolean(error)} checked={checked} className="mt-1 h-5 w-5 shrink-0" id={id} onChange={(event) => common ? updateRequired(item.key as RequiredConfirmation, event.target.checked) : updateOptional(child!.draftId, item.key as "photoShareConsent" | "photoMarketingConsent", event.target.checked)} required={item.required} type="checkbox" />{item.checkLabel}</label>
      {error ? <p className="text-sm text-red-600" id={`${id}-error`}>{error}</p> : null}
      {!common ? <p className="text-xs">선택 결과: {checked ? "동의" : "미동의"}</p> : null}
    </div>;
  }
  return <div className="space-y-5" data-testid="application-consents">
    <fieldset className="min-w-0 space-y-3" id="application-consentVersion" tabIndex={-1}><legend className="font-semibold">필수 확인·동의</legend>{errors.consentVersion ? <p className="text-sm text-red-600" role="alert">{errors.consentVersion}</p> : null}<p className="break-words text-sm">적용 대상: {children.map((child, index) => `${child.childName || `자녀 ${index + 1}`} · ${classes.find((item) => item.id === child.classScheduleId)?.label || "클래스 선택 필요"}`).join(" / ")}</p>{items.filter((item) => item.required).map((item) => consent(item))}</fieldset>
    <fieldset className="min-w-0 space-y-3"><legend className="font-semibold">선택 동의</legend><p className="text-sm">동의하지 않아도 참가에 제한이 없습니다.</p>{children.map((child, index) => <div className="space-y-3 rounded border p-3" key={child.draftId}><h3 className="break-words font-medium">{child.childName || `자녀 ${index + 1}`} · {classes.find((item) => item.id === child.classScheduleId)?.label}</h3>{items.filter((item) => !item.required).map((item) => consent(item, child, index))}</div>)}</fieldset>
    <p className="text-xs text-slate-600">동의 문구 버전: {version}. 아이별 동의 결과와 문구 버전을 저장합니다.</p>
  </div>;
}
