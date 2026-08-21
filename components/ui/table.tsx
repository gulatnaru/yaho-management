import * as React from "react";
import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-slate-200 bg-slate-50", className)} {...props} />;
}

function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-slate-100", className)} {...props} />;
}

function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-slate-50", className)} {...props} />;
}

function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn("h-10 px-4 text-left align-middle font-medium text-slate-500", className)} {...props} />
  );
}

function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
