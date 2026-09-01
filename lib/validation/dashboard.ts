import { z } from "zod";

const optionalMonth = z
  .preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined),
    z.string().regex(/^\d{4}-\d{2}$/).optional(),
  )
  .catch(undefined);

const optionalDate = z
  .preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  )
  .catch(undefined);

export const dashboardSearchSchema = z.object({
  month: optionalMonth,
  date: optionalDate,
});

export type DashboardSearchInput = z.infer<typeof dashboardSearchSchema>;
