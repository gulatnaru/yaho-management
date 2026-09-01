"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[dashboard] page error:", error.digest ?? error.message);
  }, [error]);

  return (
    <section className="flex flex-col items-center gap-4 rounded-lg border border-dashed bg-white p-10 text-center">
      <p className="text-slate-600">대시보드 데이터를 불러오는 중 문제가 발생했습니다.</p>
      <Button onClick={reset} type="button">다시 시도</Button>
    </section>
  );
}
