"use client";
import { Button } from "@/components/ui/button";
export default function ApplicationsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="space-y-4"><h1 className="text-2xl font-bold">예약 신청</h1><p role="alert">신청을 불러오지 못했습니다</p><Button className="min-h-11" onClick={reset}>재시도</Button></section>;
}
