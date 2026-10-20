import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const status = z.enum(["SUBMITTED", "CONFIRMED", "REJECTED", "CANCELLED", "all"]);
const notification = z.enum(["all", "received", "none", "legacy"]);
const bankRecord = z.enum(["all", "recorded", "none", "legacy"]);
const page = z.union([z.string().regex(/^[0-9]+$/), z.number()]).pipe(z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER));
export type ApplicationSearchParams = Record<string, unknown>;
export type FamilyFilters = ReturnType<typeof parseFamilyFilters>;

/** Unknown/repeated parameters never enter links. Invalid values fall back independently. */
export function parseFamilyFilters(input: ApplicationSearchParams = {}) {
  return {
    status: status.catch("SUBMITTED").parse(input.status),
    classScheduleId: id.optional().catch(undefined).parse(input.classScheduleId),
    notification: notification.catch("all").parse(input.notification),
    bankRecord: bankRecord.catch("all").parse(input.bankRecord),
    page: page.catch(1).parse(input.page),
  };
}
export function familyAnchor(kind: "submission" | "legacy", familyId: string) {
  return `family-${kind}-${id.parse(familyId)}`;
}
export function familyListHref(input: ApplicationSearchParams = {}, anchor?: string) {
  const filters = parseFamilyFilters(input);
  const query = new URLSearchParams();
  if (filters.status !== "SUBMITTED") query.set("status", filters.status);
  if (filters.classScheduleId) query.set("classScheduleId", filters.classScheduleId);
  if (filters.notification !== "all") query.set("notification", filters.notification);
  if (filters.bankRecord !== "all") query.set("bankRecord", filters.bankRecord);
  if (filters.page !== 1) query.set("page", String(filters.page));
  const safeAnchor = z.string().regex(/^family-(submission|legacy)-[A-Za-z0-9_-]{1,128}$/).safeParse(anchor);
  return `/reservation-applications${query.size ? `?${query}` : ""}${safeAnchor.success ? `#${safeAnchor.data}` : ""}`;
}
export function familyDetailHref(kind: "submission" | "legacy", familyId: string, input: ApplicationSearchParams) {
  const list = familyListHref(input);
  const query = list.split("?")[1];
  return `/reservation-applications/${kind === "submission" ? "submissions/" : ""}${id.parse(familyId)}${query ? `?${query}` : ""}`;
}
export function familyReturnHref(kind: "submission" | "legacy", familyId: string, input: ApplicationSearchParams = {}) {
  return familyListHref(input, familyAnchor(kind, familyId));
}
