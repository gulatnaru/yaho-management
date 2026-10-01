import type { ClassStatus } from "@prisma/client";

/**
 * 예약 신청 링크의 접수 가능 여부를 판정하는 순수 함수 모음(ADR-052).
 * DB 값을 바꾸지 않는 조회 시점 계산이며, 공개 화면 렌더링과 공개 제출 action 이
 * 같은 함수를 각각 호출해 서버에서 두 번 확인한다.
 */

export type ApplicationAvailabilityContext = {
  now: Date;
  /** Production 또는 로컬(VERCEL_ENV 없음)에서만 true. Preview 는 공유 DB 라 접수하지 않는다. */
  environmentAllowed: boolean;
  /** 입금 안내·채널 링크 설정이 모두 유효할 때 true. */
  configReady: boolean;
  /** 동의 문구가 운영 환경에서 쓸 수 있는 원문일 때 true. */
  consentReady: boolean;
};

export type ApplicationLinkForAvailability = {
  isActive: boolean;
  classSchedule: { status: ClassStatus; startsAt: Date };
};

export function isPublicApplicationEnvironment(vercelEnv: string | undefined): boolean {
  return vercelEnv === undefined || vercelEnv === "" || vercelEnv === "production";
}

export function isApplicationRuntimeReady(context: ApplicationAvailabilityContext): boolean {
  return context.environmentAllowed && context.configReady && context.consentReady;
}

/** 만석 여부는 판정에 쓰지 않는다. 가용성을 고객에게 드러내지 않기 위해서다. */
export function isApplicationLinkOpen(
  link: ApplicationLinkForAvailability | null,
  context: ApplicationAvailabilityContext,
): boolean {
  if (!isApplicationRuntimeReady(context)) return false;
  if (!link || !link.isActive) return false;
  if (link.classSchedule.status !== "SCHEDULED") return false;
  return link.classSchedule.startsAt.getTime() > context.now.getTime();
}

/** 새 링크 발급·재발급이 의미 있는 클래스인지. 취소됐거나 이미 시작한 클래스는 발급하지 않는다. */
export function canIssueApplicationLink(
  classSchedule: { status: ClassStatus; startsAt: Date },
  now: Date,
): boolean {
  return classSchedule.status === "SCHEDULED" && classSchedule.startsAt.getTime() > now.getTime();
}

export type ApplicationLinkAdminState =
  | "NONE"
  | "OPEN"
  | "STOPPED"
  | "CLASS_CANCELLED"
  | "CLASS_STARTED"
  | "RUNTIME_NOT_READY";

/** ADMIN 클래스 상세의 링크 카드 상태. 공개 화면 판정과 같은 기준을 쓴다. */
export function getApplicationLinkAdminState(
  link: { isActive: boolean } | null,
  classSchedule: { status: ClassStatus; startsAt: Date },
  context: ApplicationAvailabilityContext,
): ApplicationLinkAdminState {
  if (classSchedule.status === "CANCELLED") return "CLASS_CANCELLED";
  if (!canIssueApplicationLink(classSchedule, context.now)) return "CLASS_STARTED";
  if (!link) return "NONE";
  if (!link.isActive) return "STOPPED";
  if (!isApplicationRuntimeReady(context)) return "RUNTIME_NOT_READY";
  return "OPEN";
}
