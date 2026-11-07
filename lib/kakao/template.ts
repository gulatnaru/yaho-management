import "server-only";
import { z } from "zod";
import { renderedBodySchema } from "@/lib/kakao/send-contract";

export const TEMPLATE_ID = "mock_application_received_v1" as const;
export const TEMPLATE_VERSION = "g2-v1" as const;
export const externalReadiness = { profile: "unknown", template: "unknown", ready: false } as const;

export function formatSubmittedAt(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("Invalid submittedAt.");
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const result = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(result)) throw new Error("Invalid submittedAt.");
  return result;
}

const inputSchema = z.object({ templateId: z.literal(TEMPLATE_ID), templateVersion: z.literal(TEMPLATE_VERSION), variables: z.object({ 접수시각: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/) }).strict() }).strict();
/** Render only in server memory immediately before the mock call. */
export function renderTemplate(input: unknown): string {
  const data = inputSchema.parse(input);
  return renderedBodySchema.parse(`새 예약 신청이 접수되었습니다. 접수 시각: ${data.variables.접수시각}. YAHO 관리자 화면에서 확인해주세요.`);
}
