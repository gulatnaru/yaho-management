"use client";

import { ApplicationWizard } from "../../_components/application-wizard";
import { APPLICATION_CLOSED_MESSAGE } from "@/lib/reservation-applications/constants";
import type { ApplicationConsentItem } from "@/lib/reservation-applications/consent-content";
import type { WizardClass } from "@/lib/reservation-applications/application-draft";
import type { ReservationApplicationFormState } from "../actions";

export interface ReservationApplicationFormProps {
  action: (state: ReservationApplicationFormState, formData: FormData) => Promise<ReservationApplicationFormState>;
  consentItems: ApplicationConsentItem[];
  classInfo?: WizardClass;
}
/** Phase 18 retains one child and its original amount-free action/storage contract. */
export function ReservationApplicationForm({ action, consentItems, classInfo }: ReservationApplicationFormProps) {
  return <ApplicationWizard action={async (_state, form) => {
    const payload = JSON.parse(String(form.get("payload"))) as { guardianName: string; guardianPhone: string; guardianRelationship: string; children: Array<Record<string, string | boolean>> };
    const input = new FormData();
    const child = payload.children[0]!;
    for (const [key, value] of Object.entries({ ...child, guardianName: payload.guardianName, guardianPhone: payload.guardianPhone, guardianRelationship: payload.guardianRelationship })) input.set(key, typeof value === "boolean" ? value ? "on" : "" : value);
    input.set("website", String(form.get("website") ?? ""));
    const result = await action({}, input);
    if (result.submitted) return { submitted: true };
    if (result.formError === APPLICATION_CLOSED_MESSAGE) return { closed: true };
    const fieldErrors: Record<string, string> = {};
    for (const [key, messages] of Object.entries(result.errors ?? {})) if (messages?.[0]) fieldErrors[key.startsWith("child") || key === "requestNote" ? `children.0.${key}` : key] = messages[0];
    return { error: result.formError, fieldErrors };
  }} classes={[classInfo ?? { id: "legacy", label: "이 클래스로 신청합니다.", applicationPrice: null }]} consentItems={consentItems} legacy />;
}
