import * as React from "react";
import { cn } from "@/lib/utils";

export type WarningBannerProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * 비활성화 등 파괴적이지 않은 주의 안내에 쓰는 공용 경고 배너.
 * 제출/동작을 막지 않고 정보만 전달한다(하드 가드 아님, ADR-018 참고).
 */
function WarningBanner({ className, ...props }: WarningBannerProps) {
  return (
    <div
      className={cn("rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800", className)}
      role="status"
      {...props}
    />
  );
}

export { WarningBanner };
