"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "./form-feedback";

/** Copy only the supplied value; this component never issues or restores a link. */
export function CopyControl({ value, label = "신청 링크", buttonLabel = "링크 복사", valueLabel = `${label} 주소`, successMessage = `${label}를 복사했습니다.`, failureMessage = "복사하지 못했습니다. 직접 선택해서 복사해 주세요.", rows = 3, disabled = false }: {
  value: string;
  label?: string;
  buttonLabel?: string;
  valueLabel?: string;
  successMessage?: string;
  failureMessage?: string;
  rows?: number;
  disabled?: boolean;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  return <div className="min-w-0 space-y-2">
    <textarea aria-label={valueLabel} className="min-h-11 w-full min-w-0 resize-none rounded border p-2 text-sm [overflow-wrap:anywhere]" onFocus={(event) => event.currentTarget.select()} readOnly rows={rows} spellCheck={false} value={value} />
    <Button className="min-h-11 w-full md:w-auto" disabled={!hydrated || disabled || !value} onClick={async () => {
      setNotice(undefined); setError(undefined);
      try { await navigator.clipboard.writeText(value); setNotice(successMessage); }
      catch { setError(failureMessage); }
    }} type="button">{buttonLabel}</Button>
    <FormFeedback error={error} notice={notice} />
  </div>;
}
