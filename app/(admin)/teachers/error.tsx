"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function TeachersError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[teachers] list page error:", error.digest ?? error.message);
  }, [error]);

  return (
    <section className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-slate-200 p-10 text-center">
      <p className="text-slate-600">선생님 목록을 불러오는 중 문제가 발생했습니다.</p>
      <Button onClick={reset} type="button">
        다시 시도
      </Button>
    </section>
  );
}
