import type { Prisma } from "@prisma/client";

export type LockedChildRow = { isActive: boolean; personalDataPurgedAt: Date | null };

/**
 * Child 행 잠금 규약(ADR-058).
 * - 아이에게 예약·동의·안전정보·예약 취소 상세사유를 새로 쓰는 트랜잭션은 쓰기 전에 이 함수로 Child 행을 FOR SHARE 로 잠그고,
 *   돌려받은 personalDataPurgedAt·isActive 로 판정한다.
 * - 보관기간 만료 파기(server/reservation-applications/retention.ts)는 같은 행을 FOR UPDATE 로 잠근 뒤 만료 여부를 다시 확인한다.
 * FOR SHARE 끼리는 서로 막지 않고 FOR UPDATE 와는 서로 기다리므로, 두 경로는 항상 한쪽이 커밋된 뒤에 실행된다.
 * READ COMMITTED 에서 잠금을 기다린 문장은 상대가 커밋한 최신 행을 돌려주므로, 이 값으로 판정하면 파기 직후의 상태를 본다.
 *
 * 잠금 순서: ClassSchedule(예약 생성) → Child → Reservation 등 아이에게 딸린 행. 파기는 ClassSchedule 을 잠그지 않는다.
 */
export async function lockChildForShare(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  childId: string,
): Promise<LockedChildRow | null> {
  const rows = await tx.$queryRaw<LockedChildRow[]>`
    SELECT "isActive", "personalDataPurgedAt" FROM "Child" WHERE "id" = ${childId} FOR SHARE
  `;
  return rows[0] ?? null;
}
