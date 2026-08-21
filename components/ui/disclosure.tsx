import * as React from "react";
import { cn } from "@/lib/utils";

export interface DisclosureProps extends Omit<React.HTMLAttributes<HTMLDetailsElement>, "children"> {
  /** summary(트리거)로 렌더될 노드. 아이콘 + 텍스트 조합을 권장한다 (docs/UI-GUIDELINES.md #4). */
  summary: React.ReactNode;
  /** 펼쳐졌을 때 보여줄 내용. */
  children: React.ReactNode;
  /** 초기 펼침 여부. 접힘 대상 필드에 값이 있으면 true를 넘긴다. */
  open?: boolean;
}

/**
 * 네이티브 <details>/<summary> 기반 공용 펼침 컴포넌트.
 * 클라이언트 JS 없이 브라우저 기본 동작으로 펼침/접힘을 처리한다 (docs/UI-GUIDELINES.md #4).
 */
export function Disclosure({ summary, children, open, className, ...props }: DisclosureProps) {
  return (
    <details className={cn("group", className)} open={open} {...props}>
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
