import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  isApplicationLinkOpen,
  isApplicationRuntimeReady,
  type ApplicationAvailabilityContext,
} from "./availability";
import { isWellFormedApplicationLinkToken } from "./token";

/**
 * 비로그인 신청 화면의 조회(ADR-052). 두 단계로 나눈다.
 *
 * 1. 접수 판정용 — isApplicationLinkOpen 에 필요한 최소 필드만 읽는다.
 * 2. 화면 표시용 — 1에서 열린 링크로 판정됐을 때만 클래스 표시 정보를 읽는다.
 *
 * 닫힌 링크(무효·중지·취소·시작된 클래스·설정 미비)의 응답에는 장소·프로그램 같은 클래스 정보가
 * 어디에도 담기면 안 된다. 서버 컴포넌트가 await 한 값은 개발 모드 RSC payload 의 디버그 정보에 실릴 수 있으므로,
 * 판정 전에는 표시 정보를 아예 조회하지 않는다.
 *
 * 가격·정원·예약 인원·잔여석·선생님·클래스 메모·보험·안전 메모·다른 클래스는 어느 단계에서도 조회하지 않는다.
 * 두 select 에 필드를 추가하면 공개 응답에 그대로 노출될 수 있으므로 테스트가 필드 목록을 검사한다.
 */

/** 1단계: 접수 판정에 필요한 최소 필드 */
export const PUBLIC_APPLICATION_LINK_AVAILABILITY_SELECT = {
  isActive: true,
  classSchedule: { select: { status: true, startsAt: true } },
} as const satisfies Prisma.ReservationApplicationLinkSelect;

/** 2단계: 열린 링크의 공개 화면에 보여줄 클래스 정보 */
export const PUBLIC_APPLICATION_CLASS_SELECT = {
  startsAt: true,
  endsAt: true,
  location: true,
  program: {
    select: { name: true, description: true, targetAgeMin: true, targetAgeMax: true },
  },
} as const satisfies Prisma.ClassScheduleSelect;

export type PublicApplicationLinkAvailability = Prisma.ReservationApplicationLinkGetPayload<{
  select: typeof PUBLIC_APPLICATION_LINK_AVAILABILITY_SELECT;
}>;

export type PublicApplicationClass = Prisma.ClassScheduleGetPayload<{
  select: typeof PUBLIC_APPLICATION_CLASS_SELECT;
}>;

/** 닫힌 링크는 사유와 클래스 존재 여부를 구분하지 않는다. 클래스 정보는 열린 경우에만 담긴다. */
export type PublicApplicationView = { open: false } | { open: true; classSchedule: PublicApplicationClass };

const CLOSED_VIEW: PublicApplicationView = { open: false };

async function findApplicationLinkAvailability(token: string): Promise<PublicApplicationLinkAvailability | null> {
  return prisma.reservationApplicationLink.findUnique({
    where: { token },
    select: PUBLIC_APPLICATION_LINK_AVAILABILITY_SELECT,
  });
}

/**
 * 열린 링크의 클래스 표시 정보. 1단계와 이 조회 사이에 링크가 중지되거나 클래스가 취소·시작됐을 수 있으므로
 * 같은 접수 조건을 조회 조건에도 넣어, 그 사이 닫힌 링크는 표시 정보 없이 null 이 된다.
 */
async function findOpenPublicApplicationClass(token: string, now: Date): Promise<PublicApplicationClass | null> {
  const link = await prisma.reservationApplicationLink.findFirst({
    where: {
      token,
      isActive: true,
      classSchedule: { status: "SCHEDULED", startsAt: { gt: now } },
    },
    select: { classSchedule: { select: PUBLIC_APPLICATION_CLASS_SELECT } },
  });
  return link?.classSchedule ?? null;
}

/**
 * 공개 신청 화면이 쓰는 유일한 조회 진입점. 닫힌 링크이면 클래스 정보 없이 `{ open: false }` 만 돌려준다.
 * 제출 action 은 이 결과를 믿지 않고 server/reservation-applications/submit.ts 에서 다시 판정한다.
 */
export async function loadPublicApplicationView(
  token: string,
  context: ApplicationAvailabilityContext,
): Promise<PublicApplicationView> {
  if (!isWellFormedApplicationLinkToken(token)) return CLOSED_VIEW;
  // 설정 미비·Preview 는 링크와 무관하게 닫혀 있으므로 DB 를 읽지 않는다.
  if (!isApplicationRuntimeReady(context)) return CLOSED_VIEW;

  const availability = await findApplicationLinkAvailability(token);
  if (!availability?.classSchedule || !isApplicationLinkOpen(availability as PublicApplicationLinkAvailability & { classSchedule: NonNullable<PublicApplicationLinkAvailability["classSchedule"]> }, context)) return CLOSED_VIEW;

  const classSchedule = await findOpenPublicApplicationClass(token, context.now);
  return classSchedule ? { open: true, classSchedule } : CLOSED_VIEW;
}
