import * as React from "react";
import { cn } from "@/lib/utils";

export type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement>;

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ className, ...props }, ref) => (
  <input
    className={cn(
      "h-4 w-4 rounded border border-slate-300 text-slate-900 outline-none focus:ring-2 focus:ring-slate-900 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    ref={ref}
    type="checkbox"
    {...props}
  />
));
Checkbox.displayName = "Checkbox";

export { Checkbox };
