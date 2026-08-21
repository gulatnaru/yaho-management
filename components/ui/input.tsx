import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    className={cn(
      "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-offset-2 placeholder:text-slate-400 focus:ring-2 focus:ring-slate-900 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
