import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isWellFormedApplicationLinkToken } from "./token";

/**
 * 비로그인 신청 화면이 조회하는 필드(ADR-052).
 * 가격·정원·예약 인원·선생님·클래스 메모·보험·안전 메모·다른 클래스는 조회하지 않는다.
 * 이 select 에 필드를 추가하면 공개 화면 응답에 그대로 노출될 수 있으므로 테스트가 금지 필드를 검사한다.
 */
export const PUBLIC_APPLICATION_LINK_SELECT = {
  isActive: true,
  classSchedule: {
    select: {
      status: true,
      startsAt: true,
      endsAt: true,
      location: true,
      program: {
        select: { name: true, description: true, targetAgeMin: true, targetAgeMax: true },
      },
    },
  },
} as const satisfies Prisma.ReservationApplicationLinkSelect;

export type PublicApplicationLink = Prisma.ReservationApplicationLinkGetPayload<{
  select: typeof PUBLIC_APPLICATION_LINK_SELECT;
}>;

export async function findPublicApplicationLink(token: string): Promise<PublicApplicationLink | null> {
  if (!isWellFormedApplicationLinkToken(token)) return null;
  return prisma.reservationApplicationLink.findUnique({
    where: { token },
    select: PUBLIC_APPLICATION_LINK_SELECT,
  });
}
