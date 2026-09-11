import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChildHistoryItem } from "@/server/children/history";
import { ChildHistoryCard } from "./child-history-card";

type ChildHistorySectionProps = {
  id: string;
  title: string;
  description: string;
  emptyMessage: string;
  items: ChildHistoryItem[];
  now: Date;
  moreHref?: string;
};

export function ChildHistorySection({
  id,
  title,
  description,
  emptyMessage,
  items,
  now,
  moreHref,
}: ChildHistorySectionProps) {
  const headingId = `${id}-heading`;

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3" id={id}>
      <div>
        <h2 className="text-lg font-semibold" id={headingId}>
          {title}
        </h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
          {emptyMessage}
        </p>
      ) : (
        <ul className="min-w-0 space-y-3">
          {items.map((item) => (
            <li className="min-w-0" key={item.id}>
              <ChildHistoryCard item={item} now={now} />
            </li>
          ))}
        </ul>
      )}
      {moreHref ? (
        <Link className={cn(buttonVariants(), "w-full md:w-auto")} href={moreHref}>
          지난 이력 더보기
        </Link>
      ) : null}
    </section>
  );
}
