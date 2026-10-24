import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { APPLICATION_REQUEST_NOTE_GUIDE, APPLICATION_REQUEST_NOTE_MAX_LENGTH } from "@/lib/reservation-applications/constants";
import type { ChildDraft, WizardClass } from "@/lib/reservation-applications/application-draft";
import { money } from "./public-class-card";
export type RepeatChild = { id: string; name: string; birthDate: string; gender: string };
export type DraftErrors = Record<string, string>;
export function ChildDraftCard({ child, index, count, classes, repeatChildren, expanded, errors, update, chooseRepeat, toggle, remove, legacy }: {
  child: ChildDraft; index: number; count: number; classes: WizardClass[]; repeatChildren: RepeatChild[]; expanded: boolean; errors: DraftErrors;
  update: (key: keyof ChildDraft, value: string | boolean) => void; chooseRepeat: (id: string) => void; toggle: () => void; remove: () => void; legacy: boolean;
}) {
  const item = classes.find((item) => item.id === child.classScheduleId);
  const reused = Boolean(child.requestedChildId);
  const error = (key: string) => errors[`children.${index}.${key}`];
  const id = (key: string) => `application-${child.draftId}-${key}`;
  const feedback = (key: string) => error(key) ? <p className="text-sm text-red-600" id={`${id(key)}-error`}>{error(key)}</p> : null;
  const attributes = (key: string) => ({ "aria-invalid": Boolean(error(key)), "aria-describedby": error(key) ? `${id(key)}-error` : undefined, id: id(key) });
  return <fieldset className="min-w-0 space-y-3 rounded-lg border p-4">
    <legend className="max-w-full break-words px-1 font-semibold">자녀 {index + 1} · {child.childName || "입력 필요"}</legend>
    <p className="break-words text-sm">{item?.label || "이 아이의 클래스를 다시 선택해 주세요."}{!legacy && item?.applicationPrice !== null && item?.applicationPrice !== undefined ? ` · ${money(item.applicationPrice)}` : ""}</p>
    <Button aria-expanded={expanded} className="min-h-11" onClick={toggle} type="button">{expanded ? "자녀 정보 접기" : "아이 정보 수정"}</Button>
    {expanded ? <div className="space-y-4">
      {!legacy && repeatChildren.length > 0 ? <label className="block space-y-1"><span className="text-sm">내 기존 자녀 선택</span><Select className="min-h-11" {...attributes("requestedChildId")} aria-label={`아이 ${index + 1} 기존 아이`} onChange={(event) => chooseRepeat(event.target.value)} value={child.requestedChildId ?? ""}><option value="">새 아이로 신청</option>{repeatChildren.map((owned) => <option key={owned.id} value={owned.id}>{owned.name}</option>)}</Select></label> : null}{!legacy && repeatChildren.length === 0 && error("requestedChildId") ? <p id={id("requestedChildId")} tabIndex={-1}>{error("requestedChildId")}</p> : feedback("requestedChildId")}
      <label className="block space-y-1"><span className="text-sm">신청 클래스 (필수)</span><Select className="min-h-11" {...attributes("classScheduleId")} aria-label={`아이 ${index + 1} 클래스`} onChange={(event) => update("classScheduleId", event.target.value)} value={child.classScheduleId}><option value="">클래스 선택</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>{feedback("classScheduleId")}
      {reused ? <p className="text-sm">기존 자녀 정보는 확인만 할 수 있습니다. 다른 정보를 입력하려면 새 아이로 신청해 주세요.</p> : null}
      {([['childName','아이 이름','text'], ['childBirthDate','생년월일','date']] as const).map(([key, label, type]) => <div className="min-w-0 space-y-1" key={key}><label className="text-sm" htmlFor={id(key)}>{label} (필수)</label><Input {...attributes(key)} autoComplete="off" className="min-h-11 max-w-full min-w-0" maxLength={key === "childName" ? 50 : undefined} max={key === "childBirthDate" ? new Date().toISOString().slice(0, 10) : undefined} name={legacy ? key : undefined} onChange={(event) => update(key, event.target.value)} readOnly={reused} type={type} value={child[key]} />{feedback(key)}</div>)}
      <label className="block space-y-1"><span className="text-sm">성별</span><Select className="min-h-11" {...attributes("childGender")} disabled={reused} onChange={(event) => update("childGender", event.target.value)} value={child.childGender}><option value="UNSPECIFIED">선택 안 함</option><option value="FEMALE">여아</option><option value="MALE">남아</option></Select></label>{feedback("childGender")}
      <div className="space-y-1"><label className="text-sm" htmlFor={id("requestNote")}>요청사항 (선택)</label><p className="text-xs text-slate-600" id={`${id("requestNote")}-guide`}>{APPLICATION_REQUEST_NOTE_GUIDE}</p><Textarea {...attributes("requestNote")} aria-describedby={`${id("requestNote")}-guide${error("requestNote") ? ` ${id("requestNote")}-error` : ""}`} maxLength={APPLICATION_REQUEST_NOTE_MAX_LENGTH} onChange={(event) => update("requestNote", event.target.value)} value={child.requestNote} />{feedback("requestNote")}</div>
      {count > 1 ? <details><summary className="flex min-h-11 cursor-pointer items-center text-sm underline">이 아이를 신청에서 제외</summary><p className="my-2 break-words text-sm">{child.childName || `자녀 ${index + 1}`} · {item?.label || "클래스 선택 필요"} — 현재 신청 초안에서만 제외합니다.</p><Button className="min-h-11" onClick={remove} type="button">이 아이를 현재 초안에서 제외</Button></details> : null}
    </div> : null}
  </fieldset>;
}
