"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "./form-feedback";

/** The caller supplies an actual address; this component never issues or restores one. */
export function CopyControl({ value, label = "신청 링크", disabled = false }: { value: string; label?: string; disabled?: boolean }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  return <div className="min-w-0 space-y-2">
    <textarea aria-label={`${label} 주소`} className="w-full resize-none rounded border p-2 text-sm" onFocus={(event) => event.currentTarget.select()} readOnly rows={3} value={value} />
    <Button className="min-h-11 w-full md:w-auto" disabled={!hydrated || disabled || !value} onClick={async () => {
      setNotice(undefined); setError(undefined);
      try { await navigator.clipboard.writeText(value); setNotice(`${label}를 복사했습니다.`); }
      catch { setError("복사하지 못했습니다. 주소를 길게 눌러 복사해 주세요."); }
    }} type="button">링크 복사</Button>
    <FormFeedback error={error} notice={notice} />
  </div>;
}
