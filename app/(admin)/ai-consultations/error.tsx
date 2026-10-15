"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="space-y-3">
      <p role="alert">
        상담 검증 기능을 사용할 수 없습니다. 승인된 실행과 설정을 확인해 주세요.
      </p>
      <Button onClick={reset}>다시 확인</Button>
    </section>
  );
}
