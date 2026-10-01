"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { confirmApplicationDeposit } from "../actions";

/** 입금 확인을 기록한다. 되돌리는 기능은 없으므로 한 번 더 확인받는다. */
export function DepositConfirmButton({ applicationId }: { applicationId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const router = useRouter();

  function handleClick() {
    if (!window.confirm("입금을 확인하셨나요? 입금 확인 기록은 되돌릴 수 없습니다.")) return;
    setError(undefined);
    startTransition(async () => {
      const result = await confirmApplicationDeposit(applicationId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">
        입금을 확인한 뒤 기록하면 예약 확정을 진행할 수 있습니다. 결제 등록은 확정 후 결제 화면에서 따로 합니다.
      </p>
      <Button className="w-full md:w-auto" disabled={pending} onClick={handleClick} type="button">
        {pending ? "처리 중..." : "입금 확인 기록"}
      </Button>
      {error ? (
        <p aria-live="polite" className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
