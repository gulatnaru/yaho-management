"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { purgeExpiredPersonalData } from "../actions";

/** 파기는 되돌릴 수 없으므로 한 번 더 확인받는다. */
export function PurgeExpiredButton({ applicationCount, childCount }: { applicationCount: number; childCount: number }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | undefined>();
  const router = useRouter();

  function handleClick() {
    if (
      !window.confirm(
        `보관기간이 지난 신청 ${applicationCount}건과 확정 고객 ${childCount}명의 개인정보를 파기할까요? 파기하면 되돌릴 수 없습니다.`,
      )
    ) {
      return;
    }
    setMessage(undefined);
    startTransition(async () => {
      const result = await purgeExpiredPersonalData();
      if (result.error) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({
        tone: "ok",
        text: `신청 ${result.purgedApplicationCount ?? 0}건, 확정 고객 ${result.purgedChildCount ?? 0}명의 개인정보를 파기했습니다.`,
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button
        className="w-full md:w-auto"
        disabled={pending || applicationCount + childCount === 0}
        onClick={handleClick}
        type="button"
      >
        {pending ? "처리 중..." : "보관기간 지난 개인정보 파기"}
      </Button>
      {message ? (
        <p
          aria-live="polite"
          className={message.tone === "ok" ? "text-sm text-emerald-700" : "text-sm text-red-600"}
          role={message.tone === "ok" ? "status" : "alert"}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
