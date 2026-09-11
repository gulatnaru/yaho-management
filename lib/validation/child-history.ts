import { z } from "zod";
import { MAX_CHILD_HISTORY_PAGE } from "@/lib/children/history";

const childHistoryPageSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .refine((page) => page <= MAX_CHILD_HISTORY_PAGE)
  .catch(1);

export function parseChildHistoryPage(value: string | string[] | undefined): number {
  const firstValue = Array.isArray(value) ? value[0] : value;
  return childHistoryPageSchema.parse(firstValue ?? "1");
}
