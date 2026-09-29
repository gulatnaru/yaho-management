"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { purgeExpiredApplications } from "../actions";

/** 파기는 되돌릴 수 없으므로 한 번 더 확인받는다. */
export function PurgeExpiredButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | undefined>();
  const router = useRouter();

  function handleClick() {
    if (!window.confirm(`보관기간이 지난 신청 ${count}건의 개인정보를 파기할까요? 파기하면 되돌릴 수 없습니다.`)) {
      return;
    }
    setMessage(undefined);
    startTransition(async () => {
      const result = await purgeExpiredApplications();
      if (result.error) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "ok", text: `${result.purgedCount ?? 0}건의 개인정보를 파기했습니다.` });
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button className="w-full md:w-auto" disabled={pending || count === 0} onClick={handleClick} type="button">
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
