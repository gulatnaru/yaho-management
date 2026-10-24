"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { APPLICATION_CONSENT_CONTENT, type ApplicationConsentItem } from "@/lib/reservation-applications/consent-content";
import { addChildDraft, createChildDraft, emptyConfirmations, emptyGuardian, errorChildIndex, errorStep, expectedAmount, fieldElementId, reconcileAssignments, removeChildDraft, REQUIRED_CONFIRMATIONS, submissionChildren, type ChildDraft, type RequiredConfirmation, type WizardClass } from "@/lib/reservation-applications/application-draft";
import { isCalendarDate } from "@/lib/validation/reservation-application";
import { phoneRegex, MIN_PHONE_DIGIT_COUNT } from "@/lib/validation/child";
import { openApplicationCompletePage } from "@/lib/reservation-applications/complete-navigation";
import type { GroupSubmissionState } from "../group/[token]/actions";
import { ChildDraftCard, type DraftErrors, type RepeatChild } from "./child-draft-card";
import { PublicClassCard, money } from "./public-class-card";
import { ConsentReviewStep } from "./consent-review-step";
import { StepIndicator } from "./step-indicator";

type PriceReview = { proof: string; prices: Array<{ classScheduleId: string; amount: number }> };
export type PriceRecheck = (input: { classScheduleIds: string[]; reviewedPriceProof?: string }) => Promise<GroupSubmissionState>;
export type WizardAction = (state: GroupSubmissionState, form: FormData) => Promise<GroupSubmissionState>;
export type ApplicationWizardProps = { action: WizardAction; classes: WizardClass[]; recheck?: PriceRecheck; legacy?: boolean; consentItems?: ApplicationConsentItem[] };
const guardianSchema = z.object({
  guardianName: z.string().trim().min(1).max(50), guardianPhone: z.string().trim().regex(phoneRegex).refine((value) => value.replace(/[^0-9]/g, "").length >= MIN_PHONE_DIGIT_COUNT),
  guardianRelationship: z.enum(["MOTHER", "FATHER", "OTHER_LEGAL_GUARDIAN"]), declaredPayerName: z.string().trim().min(1).max(50),
});
const childSchema = z.object({ childName: z.string().trim().min(1).max(50), childBirthDate: z.string().refine(isCalendarDate).refine((value) => `${value}T00:00:00.000Z` <= new Date().toISOString()), childGender: z.enum(["UNSPECIFIED", "FEMALE", "MALE"]), requestNote: z.string().max(1000) });
const guardianMessages: Record<string, string> = { guardianName: "보호자 이름을 입력해 주세요.", guardianPhone: "연락처를 확인해 주세요.", guardianRelationship: "아이와의 관계를 선택해 주세요.", declaredPayerName: "입금할 때 사용할 이름을 입력해 주세요." };
const childMessages: Record<string, string> = { childName: "아이 이름을 입력해 주세요.", childBirthDate: "올바른 생년월일을 입력해 주세요. 미래 날짜는 입력할 수 없습니다.", childGender: "성별을 확인해 주세요.", requestNote: "요청사항은 1,000자 이내로 입력해 주세요." };

export function ApplicationWizard({ action, classes: initialClasses, recheck, legacy = false, consentItems = APPLICATION_CONSENT_CONTENT.items }: ApplicationWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [guardian, setGuardian] = useState(emptyGuardian);
  const [children, setChildren] = useState<ChildDraft[]>(() => [createChildDraft("child-1", initialClasses.length === 1 ? initialClasses[0]!.id : "")]);
  const [candidateIds, setCandidateIds] = useState<string[]>(() => initialClasses.length === 1 ? [initialClasses[0]!.id] : []);
  const [classes, setClasses] = useState(initialClasses);
  const [required, setRequired] = useState(emptyConfirmations);
  const [expanded, setExpanded] = useState<string[]>(["child-1"]);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [state, setState] = useState<GroupSubmissionState>({});
  const [review, setReview] = useState<PriceReview>();
  const [changedReview, setChangedReview] = useState<PriceReview>();
  const [repeat, setRepeat] = useState<RepeatChild[]>([]);
  const [repeatStatus, setRepeatStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [pending, setPending] = useState(false);
  const [abandoned, setAbandoned] = useState(false);
  const guardianDirty = useRef(false);
  const serial = useRef(1);
  const busy = useRef(false);
  const finished = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const candidates = classes.filter((item) => candidateIds.includes(item.id));
  const prices = new Map(classes.map((item) => [item.id, item.applicationPrice]));
  const total = expectedAmount(children, prices);

  useEffect(() => {
    if (legacy) return;
    let current = true;
    async function lookup() {
      try {
        const response = await fetch("/api/reservation-applications/repeat-children", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error("lookup");
        const schema = z.object({ guardian: z.object({ guardianName: z.string(), guardianPhone: z.string(), guardianRelationship: z.string() }).nullable(), children: z.array(z.object({ id: z.string(), name: z.string(), birthDate: z.string(), gender: z.string() })) });
        const profile = schema.parse(await response.json());
        if (!current || finished.current) return;
        setRepeat(profile.children); setRepeatStatus("ready");
        // A late device lookup must never replace information the guardian has started entering.
        if (profile.guardian) setGuardian((value) => guardianDirty.current ? value : { ...value, ...profile.guardian! });
      } catch { if (current) setRepeatStatus("failed"); }
    }
    void lookup();
    return () => { current = false; };
  }, [legacy]);

  useEffect(() => {
    function wipe() {
      // BFCache can retain the actual DOM as well as React memory. Wipe both before it is frozen.
      finished.current = true;
      form.current?.reset();
      flushSync(() => { setGuardian(emptyGuardian()); setChildren([createChildDraft("child-1")]); setRequired(emptyConfirmations()); setRepeat([]); setAbandoned(true); });
    }
    function restore(event: PageTransitionEvent) { if (event.persisted) wipe(); }
    window.addEventListener("pagehide", wipe); window.addEventListener("pageshow", restore);
    return () => { window.removeEventListener("pagehide", wipe); window.removeEventListener("pageshow", restore); };
  }, []);

  function closeApplication(result: GroupSubmissionState) {
    finished.current = true;
    setGuardian(emptyGuardian()); setChildren([]); setRequired(emptyConfirmations());
    setRepeat([]); setReview(undefined); setChangedReview(undefined); setErrors({});
    setState(result);
  }
  function focusError(path: string) {
    const destination = errorStep(path); const childIndex = errorChildIndex(path);
    if (childIndex !== undefined && children[childIndex]) setExpanded((items) => [...new Set([...items, children[childIndex]!.draftId])]);
    setStep(destination);
    requestAnimationFrame(() => document.getElementById(fieldElementId(path, children))?.focus());
  }
  function showErrors(next: DraftErrors) { setErrors(next); setExpanded((items) => [...new Set([...items, ...Object.keys(next).flatMap((path) => { const index = errorChildIndex(path); return index !== undefined && children[index] ? [children[index]!.draftId] : []; })])]); const first = Object.keys(next)[0]; if (first) focusError(first); }
  function go(next: 1 | 2 | 3) { setStep(next); requestAnimationFrame(() => heading.current?.focus()); }
  function resetScope() { setRequired(emptyConfirmations()); setReview(undefined); setChangedReview(undefined); }
  function toggleCandidate(id: string) {
    const ids = candidateIds.includes(id) ? candidateIds.filter((candidate) => candidate !== id) : [...candidateIds, id];
    setCandidateIds(ids); setChildren((items) => reconcileAssignments(items, ids)); resetScope();
  }
  function updateChild(id: string, key: keyof ChildDraft, value: string | boolean) {
    setChildren((items) => items.map((child) => child.draftId === id ? { ...child, [key]: value } : child));
    if (key === "classScheduleId") resetScope();
  }
  function chooseRepeat(id: string, ownedId: string) {
    const owned = repeat.find((child) => child.id === ownedId);
    setChildren((items) => items.map((child) => child.draftId === id ? { ...child, requestedChildId: owned?.id, childName: owned?.name ?? "", childBirthDate: owned?.birthDate ?? "", childGender: owned?.gender ?? "UNSPECIFIED" } : child)); resetScope();
  }
  function validateDetails() {
    const next: DraftErrors = {};
    const parsedGuardian = guardianSchema.safeParse({ ...guardian, declaredPayerName: legacy ? "legacy" : guardian.declaredPayerName });
    if (!parsedGuardian.success) for (const issue of parsedGuardian.error.issues) { const key = String(issue.path[0]); next[key] = guardianMessages[key] ?? "입력 내용을 확인해 주세요."; }
    const selectedExisting = new Set<string>();
    children.forEach((child, index) => {
      if (!candidateIds.includes(child.classScheduleId)) next[`children.${index}.classScheduleId`] = "이 아이의 클래스를 다시 선택해 주세요.";
      const parsedChild = childSchema.safeParse(child);
      if (!parsedChild.success) for (const issue of parsedChild.error.issues) { const key = String(issue.path[0]); next[`children.${index}.${key}`] = childMessages[key] ?? "입력 내용을 확인해 주세요."; }
      if (child.requestedChildId && selectedExisting.has(child.requestedChildId)) next[`children.${index}.childName`] = "같은 아이를 중복 선택할 수 없습니다.";
      if (child.requestedChildId) selectedExisting.add(child.requestedChildId);
    });
    return next;
  }
  function acceptReview(next: PriceReview) {
    setReview(next); setChangedReview(undefined);
    setClasses((items) => items.map((item) => { const price = next.prices.find((price) => price.classScheduleId === item.id); return price ? { ...item, applicationPrice: price.amount } : item; }));
    setState({}); setErrors({});
  }
  async function checkPrices(): Promise<boolean> {
    if (legacy) return true;
    if (!recheck) { setState({ error: "신청 정보를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요." }); return false; }
    const result = await recheck({ classScheduleIds: [...new Set(children.map((child) => child.classScheduleId))], reviewedPriceProof: review?.proof });
    if (result.closed) { closeApplication(result); return false; }
    if (!result.priceReview) { setState(result); return false; }
    const next = result.priceReview;
    if (result.priceReviewExpired || result.priceChanged || next.prices.some((price) => prices.get(price.classScheduleId) !== price.amount)) {
      setChangedReview(next); setState({ ...result, error: result.priceReviewExpired ? "참가비 확인 시간이 만료되었습니다. 최신 금액과 총액을 다시 확인해 주세요." : "참가비가 변경되었습니다. 변경된 금액과 총액을 다시 확인해 주세요." });
      go(3); requestAnimationFrame(() => document.getElementById("application-reviewedPriceProof")?.focus()); return false;
    }
    acceptReview(next); return true;
  }
  async function next() {
    if (busy.current || finished.current) return;
    if (step === 1) {
      if (candidateIds.length === 0) { showErrors({ classes: "신청할 클래스를 선택해 주세요." }); return; }
      setErrors({}); go(2); return;
    }
    const validation = validateDetails(); if (Object.keys(validation).length) { showErrors(validation); return; }
    busy.current = true; setPending(true);
    try { if (await checkPrices()) go(3); } catch { setState({ error: "신청 정보를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요." }); }
    finally { busy.current = false; setPending(false); }
  }
  async function submit() {
    if (step !== 3 || busy.current || finished.current || changedReview || state.resultUnknown) return;
    const validation = validateDetails();
    for (const key of REQUIRED_CONFIRMATIONS) if (!required[key]) validation[key] = "필수 항목을 확인해 주세요.";
    if (!legacy && !review) validation.reviewedPriceProof = "최신 참가비를 다시 확인해 주세요.";
    if (Object.keys(validation).length) { showErrors(validation); return; }
    busy.current = true; setPending(true); setErrors({});
    const payload = new FormData();
    payload.set("payload", JSON.stringify({ ...guardian, children: submissionChildren(children, required), reviewedPriceProof: review?.proof, consentVersion: APPLICATION_CONSENT_CONTENT.version }));
    payload.set("website", String(new FormData(form.current!).get("website") ?? ""));
    try {
      const result = await action(state, payload);
      if (result.submitted) {
        finished.current = true;
        // Erase the sensitive controls before replacing the entire document.
        flushSync(() => { setState({ submitted: true }); setGuardian(emptyGuardian()); setChildren([]); setRepeat([]); setRequired(emptyConfirmations()); });
        openApplicationCompletePage(); return;
      }
      if (result.closed) { closeApplication(result); return; }
      setState(result);
      if ((result.priceReviewExpired || result.priceChanged) && result.priceReview) { setChangedReview(result.priceReview); requestAnimationFrame(() => document.getElementById("application-reviewedPriceProof")?.focus()); }
      if (result.fieldErrors) showErrors(result.fieldErrors);
    } catch { setState({ resultUnknown: true, error: "처리 결과를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요." }); }
    finally { busy.current = false; setPending(false); }
  }
  if (state.submitted) return <p aria-live="polite" role="status">완료 화면으로 이동 중…</p>;
  if (state.closed || abandoned) return <p role="alert">현재 신청을 받지 않는 링크입니다.</p>;

  const summary = <aside aria-label="신청 요약" className="min-w-0 space-y-2 rounded-lg bg-slate-50 p-4">
    <h2 className="font-semibold">신청 요약</h2><p className="text-sm">선택한 클래스 {candidateIds.length}개{step > 1 ? ` · 신청 자녀 ${children.length}명` : ""}</p>
    {step === 1 ? <p className="text-sm">자녀 정보는 다음 단계에서 입력합니다.</p> : children.map((child, index) => <p className="break-words text-sm" key={child.draftId}>{child.childName || `자녀 ${index + 1}`} · {classes.find((item) => item.id === child.classScheduleId)?.label || "클래스 선택 필요"}{!legacy && prices.get(child.classScheduleId) ? ` · ${money(prices.get(child.classScheduleId)!)}` : ""}</p>)}
    {!legacy && step > 1 ? <p aria-live="polite" className="font-semibold">{total === null ? "클래스 선택 필요 · 예상 합계 확인 전" : `예상 총 참가비 ${money(total)}`}</p> : null}
    <p className="text-sm">{step === 1 ? "클래스 선택은 좌석 확보가 아닙니다." : "송금액과 계좌는 신청 완료 후 안내합니다."}</p>
  </aside>;
  return <form autoComplete="off" className="min-w-0 space-y-5 pb-12" noValidate onKeyDown={(event) => { if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement)) event.preventDefault(); }} onSubmit={(event) => { event.preventDefault(); }} ref={form}>
    <h1 className="text-xl font-bold outline-none" ref={heading} tabIndex={-1}>클래스 신청</h1>
    <StepIndicator step={step} /><p className="text-sm">신청은 예약 확정이 아닙니다.</p>
    {Object.keys(errors).length ? <div className="space-y-1 rounded border border-red-300 p-3" role="alert"><p>입력 내용을 확인해 주세요.</p>{Object.entries(errors).map(([path, message]) => <button className="block min-h-11 break-words text-left text-sm underline" key={path} onClick={() => focusError(path)} type="button">{errorStep(path)}단계{errorChildIndex(path) !== undefined ? ` 자녀 ${errorChildIndex(path)! + 1}${children[errorChildIndex(path)!]?.childName ? ` (${children[errorChildIndex(path)!]!.childName})` : ""}` : ""} · {message}</button>)}</div> : null}
    <fieldset className="min-w-0 space-y-5" disabled={pending || state.resultUnknown}>
      {step === 1 ? <section className="space-y-3" id="application-classes" tabIndex={-1}><h2 className="font-semibold">참여할 클래스를 확인해 주세요.</h2>{classes.map((item) => <PublicClassCard item={item} key={item.id} onChange={() => toggleCandidate(item.id)} selected={candidateIds.includes(item.id)} single={classes.length === 1} />)}{errors.classes ? <p className="text-sm text-red-600">{errors.classes}</p> : null}</section> : null}
      {step === 2 ? <div className="space-y-5" id="application-children" tabIndex={-1}>
        {errors.children ? <p className="text-sm text-red-600" role="alert">{errors.children}</p> : null}
        <fieldset className="min-w-0 space-y-3 rounded-lg border p-4"><legend className="px-1 font-semibold">보호자 정보 — 한 번만 입력해 주세요.</legend>
          {([['guardianName','보호자 이름'], ['guardianPhone','보호자 연락처'], ['declaredPayerName','입금할 때 사용할 이름']] as const).filter(([key]) => !legacy || key !== "declaredPayerName").map(([key, label]) => <div className="space-y-1" key={key}><label className="text-sm" htmlFor={`application-${key}`}>{label} (필수)</label><Input aria-describedby={errors[key] ? `application-${key}-error` : undefined} aria-invalid={Boolean(errors[key])} autoComplete="off" className="min-h-11" id={`application-${key}`} inputMode={key === "guardianPhone" ? "tel" : undefined} maxLength={key === "guardianPhone" ? 30 : 50} name={key} onChange={(event) => { guardianDirty.current = true; setGuardian((value) => ({ ...value, [key]: event.target.value })); }} type={key === "guardianPhone" ? "tel" : "text"} value={guardian[key]} />{errors[key] ? <p className="text-sm text-red-600" id={`application-${key}-error`}>{errors[key]}</p> : null}</div>)}
          <label className="block space-y-1"><span className="text-sm">아이와의 관계 (필수)</span><Select className="min-h-11" aria-describedby={errors.guardianRelationship ? "application-guardianRelationship-error" : undefined} aria-invalid={Boolean(errors.guardianRelationship)} id="application-guardianRelationship" onChange={(event) => { guardianDirty.current = true; setGuardian((value) => ({ ...value, guardianRelationship: event.target.value })); }} value={guardian.guardianRelationship}><option value="MOTHER">모</option><option value="FATHER">부</option><option value="OTHER_LEGAL_GUARDIAN">기타 법정대리인</option></Select></label>{errors.guardianRelationship ? <p id="application-guardianRelationship-error">{errors.guardianRelationship}</p> : null}
        </fieldset>
        {!legacy ? <p className="text-sm" role="status">{repeatStatus === "loading" ? "내 자녀 정보를 확인하는 중입니다." : repeatStatus === "failed" ? "기존 자녀 정보를 불러오지 못했습니다. 등록된 자녀가 없는 것으로 확인된 것은 아닙니다." : repeat.length ? "이 기기에서 확인된 내 자녀만 선택할 수 있습니다." : "이 기기에서 선택할 수 있는 자녀 정보가 없습니다."}</p> : null}
        {children.map((child, index) => <ChildDraftCard child={child} chooseRepeat={(ownedId) => chooseRepeat(child.draftId, ownedId)} classes={candidates} count={children.length} errors={errors} expanded={expanded.includes(child.draftId)} index={index} key={child.draftId} legacy={legacy} remove={() => { const nextChildren = removeChildDraft(children, child.draftId); const target = nextChildren[Math.min(index, nextChildren.length - 1)]; setChildren(nextChildren); if (target) setExpanded((items) => [...new Set([...items, target.draftId])]); setErrors({}); resetScope(); requestAnimationFrame(() => document.getElementById(`application-${target?.draftId}-childName`)?.focus()); }} repeatChildren={repeat} toggle={() => setExpanded((items) => items.includes(child.draftId) ? items.filter((id) => id !== child.draftId) : [...items, child.draftId])} update={(key, value) => updateChild(child.draftId, key, value)} />)}
        {!legacy ? <div><Button className="min-h-11" disabled={children.length >= 10} onClick={() => { const id = `child-${++serial.current}`; setChildren((items) => addChildDraft(items, createChildDraft(id, classes.length === 1 ? classes[0]!.id : ""))); setExpanded((items) => [...items, id]); setErrors({}); resetScope(); requestAnimationFrame(() => document.getElementById(`application-${id}-childName`)?.focus()); }} type="button">내 자녀 추가</Button>{children.length >= 10 ? <p className="text-sm">자녀는 최대 10명까지 신청할 수 있습니다.</p> : null}</div> : null}
      </div> : null}
      {step === 3 ? <section className="space-y-5">
        <div className="space-y-2 rounded border p-4"><h2 className="font-semibold">신청 내용 확인</h2><p className="break-words text-sm">보호자 {guardian.guardianName} · {guardian.guardianPhone} · {guardian.guardianRelationship === "MOTHER" ? "모" : guardian.guardianRelationship === "FATHER" ? "부" : "기타 법정대리인"}{!legacy ? ` · 입금자명 ${guardian.declaredPayerName}` : ""}</p>{children.map((child) => <div className="space-y-1 border-t pt-2 text-sm" key={child.draftId}><p className="break-words">{child.childName} · {child.childBirthDate} · {child.childGender === "FEMALE" ? "여아" : child.childGender === "MALE" ? "남아" : "성별 선택 안 함"}</p><p className="break-words">{classes.find((item) => item.id === child.classScheduleId)?.label}</p>{!legacy && prices.get(child.classScheduleId) ? <p>참가비 {money(prices.get(child.classScheduleId)!)}</p> : null}{child.requestNote ? <p className="whitespace-pre-wrap break-words">요청사항: {child.requestNote}</p> : null}</div>)}<div className="flex flex-wrap gap-2"><Button className="min-h-11" onClick={() => go(1)} type="button">클래스 수정</Button><Button className="min-h-11" onClick={() => go(2)} type="button">보호자·자녀 정보 수정</Button></div></div>
        {changedReview ? <div aria-live="assertive" className="space-y-3 rounded border border-amber-500 p-4 outline-none" id="application-reviewedPriceProof" role="alert" tabIndex={-1}><h2 className="font-semibold">{state.priceReviewExpired ? "참가비 확인 시간이 만료되었습니다." : "참가비가 변경되었습니다."}</h2><p>{state.priceReviewExpired ? "입력 내용은 유지됩니다. 최신 금액과 총액을 다시 확인해 주세요." : "변경된 금액과 총액을 다시 확인해 주세요."} 신청서는 저장하지 않았습니다.</p>{changedReview.prices.filter((price) => prices.get(price.classScheduleId) !== price.amount).map((price) => <p className="break-words" key={price.classScheduleId}>{classes.find((item) => item.id === price.classScheduleId)?.label} · {prices.get(price.classScheduleId) ? money(prices.get(price.classScheduleId)!) : "확인 필요"} → {money(price.amount)}</p>)}<p>가족 예상 합계 {total === null ? "확인 필요" : money(total)} → {money(expectedAmount(children, new Map(changedReview.prices.map((price) => [price.classScheduleId, price.amount])))!)}</p><Button className="min-h-11" onClick={() => acceptReview(changedReview)} type="button">{state.priceReviewExpired ? "최신 금액 다시 확인" : "변경 금액 확인"}</Button><p className="text-sm">확인 후 신청서 제출을 다시 눌러 주세요.</p></div> : null}
        {errors.reviewedPriceProof && !changedReview ? <p className="text-sm text-red-600" id="application-reviewedPriceProof" role="alert" tabIndex={-1}>{errors.reviewedPriceProof}</p> : null}
        <ConsentReviewStep drafts={children} classes={classes} errors={errors} items={consentItems} required={required} updateOptional={(id, key, value) => updateChild(id, key, value)} updateRequired={(key: RequiredConfirmation, value) => setRequired((current) => ({ ...current, [key]: value }))} version={APPLICATION_CONSENT_CONTENT.version} />
        <p className="font-semibold">아직 예약이 확정되지 않았습니다.</p><p className="text-sm">입금과 운영자 확인 후 예약이 확정됩니다.</p>
      </section> : null}
      {summary}
      <input aria-hidden="true" autoComplete="off" className="hidden" name="website" tabIndex={-1} />
      {state.error ? <p className="break-words text-sm text-red-600" role="alert">{state.error}</p> : null}
      <div className="grid gap-3">{step < 3 ? <Button className="min-h-11 w-full" onClick={() => void next()} type="button">{pending ? "신청 정보 확인 중…" : "다음"}</Button> : <Button className="min-h-11 w-full" disabled={pending || Boolean(changedReview)} onClick={() => void submit()} type="button">{pending ? "신청서 제출 중…" : "신청서 제출"}</Button>}{step > 1 ? <Button className="min-h-11 w-full" onClick={() => go(step === 3 ? 2 : 1)} type="button">이전</Button> : null}</div>
    </fieldset>
    {state.resultUnknown ? <div role="alert"><p>처리 결과를 확인하지 못했습니다. 신청서를 자동으로 다시 보내지 않습니다.</p><Button className="mt-3 min-h-11" onClick={() => openApplicationCompletePage()} type="button">신청 결과 확인</Button></div> : null}
  </form>;
}
