"use client";
import { useActionState } from "react";
import type { ReviewActionResult } from "./actions";

/**
 * Generic per-row form for the notification history actions. The server
 * action re-verifies every guard; the button is only a convenience. The
 * action result (success message or Korean error) is shown inline.
 */
export function ReviewActionForm({ action, label, fields = [], textField }: {
  action: (_previous: ReviewActionResult | null, form: FormData) => Promise<ReviewActionResult>;
  label: string;
  fields?: { name: string; value: string }[];
  textField?: { name: string; label: string; placeholder?: string };
}) {
  const [result, formAction, pending] = useActionState(action, null);
  return <form action={formAction} className="space-y-1">
    {fields.map((field) => <input key={field.name} name={field.name} type="hidden" value={field.value} />)}
    {textField && <label className="mr-2">{textField.label} <input name={textField.name} required maxLength={128} placeholder={textField.placeholder} /></label>}
    <button type="submit" disabled={pending}>{label}</button>
    {result && <p role="status">{result.ok ? result.message : result.error}</p>}
  </form>;
}
