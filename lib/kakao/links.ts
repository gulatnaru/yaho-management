import { z } from "zod";
import type { ReservationNotificationEvent } from "./notify";

const segmentSchema = z.string().refine((value) => value.trim().length > 0 && value !== "." && value !== "..");
const baseUrlSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
});
const channelUrlSchema = baseUrlSchema.refine((value) => /^https:/i.test(value.trim()));

function encodedSegment(value: string): string {
  if (!segmentSchema.safeParse(value).success) throw new Error("Invalid link identifier.");
  try { return encodeURIComponent(value); }
  catch { throw new Error("Invalid link identifier."); }
}

function absoluteUrl(baseUrl: string, path: string): string {
  if (!baseUrlSchema.safeParse(baseUrl).success) throw new Error("Invalid base URL.");
  // App routes start at the origin, regardless of any path in the caller's base URL.
  return new URL(path, baseUrl).href;
}

export function applyPath(token: string): string {
  return `/apply/${encodedSegment(token)}`;
}

export function applyUrl(baseUrl: string, token: string): string {
  return absoluteUrl(baseUrl, applyPath(token));
}

/** Requires an ADMIN session. NEVER send this URL to customers. */
export function adminSubmissionPath(submissionId: string): string {
  return `/reservation-applications/submissions/${encodedSegment(submissionId)}`;
}

/** Requires an ADMIN session. NEVER send this URL to customers. */
export function adminSubmissionUrl(baseUrl: string, submissionId: string): string {
  return absoluteUrl(baseUrl, adminSubmissionPath(submissionId));
}

export function channelChatUrl(channelUrl: string): string | null {
  return channelUrlSchema.safeParse(channelUrl).success ? channelUrl : null;
}

const eventLabels: Record<ReservationNotificationEvent, string> = {
  "application.received": "예약 신청이 접수되었습니다.",
  "application.confirmed": "예약 신청이 확정되었습니다.",
  "application.changed": "예약 신청이 변경되었습니다.",
  "application.cancelled": "예약 신청이 취소되었습니다.",
};
const shareTextSchema = z.object({
  event: z.enum(["application.received", "application.confirmed", "application.changed", "application.cancelled"]),
  programLabel: z.string().trim().min(1),
  classLabel: z.string().trim().min(1).optional(),
  scheduleText: z.string().trim().min(1),
  statusLabel: z.string().trim().min(1),
}).strict();

/**
 * Only caller-reviewed, non-PII labels are permitted. Never pass names, phone
 * numbers, amounts, tokens, internal IDs or URLs in these textual fields.
 * Unknown fields are rejected; no customer/application object is accepted.
 */
export function shareTextForReservationEvent(input: z.input<typeof shareTextSchema>): string {
  const parsed = shareTextSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid reservation share text.");
  const { event, programLabel, classLabel, scheduleText, statusLabel } = parsed.data;
  const short = (text: string, length: number) => Array.from(text).slice(0, length).join("");
  return [eventLabels[event], [short(programLabel, 80), classLabel && short(classLabel, 80)].filter(Boolean).join(" · "), short(scheduleText, 80), short(statusLabel, 40)].join("\n");
}
