import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, style, ...props }, ref) => {
  // iOS Safari는 type="date"/"time" 입력에 자체 최소 너비(네이티브 피커 UI)를 적용해 w-full을
  // 사실상 무시한다. appearance-none으로 네이티브 크롬을 벗겨내 강제로 축소 가능하게 만든다.
  // appearance-none 단독으로는 일부 iOS 버전의 내부 UA 렌더링을 완전히 못 잡는 사례가 있어
  // !min-w-0(특이성 강제)과 인라인 style min-width:0을 함께 걸어 이중 방어한다.
  const isDateOrTimeInput = props.type === "date" || props.type === "time";

  return (
    <input
      className={cn(
        "flex h-10 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-offset-2 placeholder:text-slate-400 focus:ring-2 focus:ring-slate-900 disabled:cursor-not-allowed disabled:opacity-50",
        isDateOrTimeInput && "!min-w-0 appearance-none",
        className,
      )}
      ref={ref}
      style={isDateOrTimeInput ? { minWidth: 0, ...style } : style}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
