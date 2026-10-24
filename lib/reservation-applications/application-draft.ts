import type { ApplicationConsentKey } from "./consent-content";

export const APPLICATION_STEPS = ["클래스 선택", "보호자·자녀 정보", "동의·최종 확인"] as const;
export const REQUIRED_CONFIRMATIONS = ["programTerms", "privacyConsent", "legalGuardianConfirmation", "refundTerms"] as const;
export type RequiredConfirmation = typeof REQUIRED_CONFIRMATIONS[number];
export type GuardianDraft = { guardianName: string; guardianPhone: string; guardianRelationship: string; declaredPayerName: string };
export type ChildDraft = {
  draftId: string; classScheduleId: string; requestedChildId?: string;
  childName: string; childBirthDate: string; childGender: string; requestNote: string;
  photoShareConsent: boolean; photoMarketingConsent: boolean;
};
export type WizardClass = { id: string; label: string; description?: string | null; targetAge?: string; applicationPrice: number | null };
export type RequiredConfirmations = Record<RequiredConfirmation, boolean>;
export const emptyGuardian = (): GuardianDraft => ({ guardianName: "", guardianPhone: "", guardianRelationship: "MOTHER", declaredPayerName: "" });
export const emptyConfirmations = (): RequiredConfirmations => ({ programTerms: false, privacyConsent: false, legalGuardianConfirmation: false, refundTerms: false });
export function createChildDraft(draftId: string, classScheduleId = ""): ChildDraft {
  return { draftId, classScheduleId, childName: "", childBirthDate: "", childGender: "UNSPECIFIED", requestNote: "", photoShareConsent: false, photoMarketingConsent: false };
}
export function addChildDraft(children: ChildDraft[], child: ChildDraft, maximum = 10): ChildDraft[] {
  return children.length >= maximum || children.some((item) => item.draftId === child.draftId) ? children : [...children, child];
}
export function removeChildDraft(children: ChildDraft[], draftId: string): ChildDraft[] {
  return children.length <= 1 ? children : children.filter((child) => child.draftId !== draftId);
}
/** Removing a candidate invalidates that assignment; it never silently picks a different class. */
export function reconcileAssignments(children: ChildDraft[], candidates: string[]): ChildDraft[] {
  return children.map((child) => candidates.includes(child.classScheduleId) ? child : { ...child, classScheduleId: "" });
}
export function expectedAmount(children: ChildDraft[], prices: ReadonlyMap<string, number | null>): number | null {
  let total = 0;
  for (const child of children) {
    const price = prices.get(child.classScheduleId);
    if (price === undefined || price === null || price <= 0) return null;
    total += price;
  }
  return total;
}
/** Scope changes require renewed common confirmations; optional choices stay on the stable child. */
export function consentScope(children: ChildDraft[]): string {
  return JSON.stringify(children.map(({ draftId, classScheduleId, requestedChildId }) => [draftId, classScheduleId, requestedChildId ?? ""]));
}
export function submissionChildren(children: ChildDraft[], required: RequiredConfirmations) {
  return children.map(({ draftId, ...child }) => { void draftId; return { ...child, ...required }; });
}
export function errorStep(path: string): 1 | 2 | 3 {
  if (path === "classes") return 1;
  if (REQUIRED_CONFIRMATIONS.some((key) => path === key || path.endsWith(`.${key}`)) || path === "reviewedPriceProof" || path === "consentVersion") return 3;
  return 2;
}
export function errorChildIndex(path: string): number | undefined {
  const match = /^children\.([0-9])\./.exec(path);
  return match ? Number(match[1]) : undefined;
}
export function fieldElementId(path: string, children: ChildDraft[]): string {
  const index = errorChildIndex(path);
  if (index !== undefined) {
    const key = path.split(".")[2]!;
    if ((REQUIRED_CONFIRMATIONS as readonly string[]).includes(key)) return `application-${key}`;
    return `application-${children[index]?.draftId ?? "missing"}-${key}`;
  }
  return `application-${path}`;
}
export function isRequiredConfirmation(key: ApplicationConsentKey): key is RequiredConfirmation {
  return (REQUIRED_CONFIRMATIONS as readonly string[]).includes(key);
}
