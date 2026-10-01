import type { Prisma, PrismaClient } from "@prisma/client";
import { ChildPersonalDataPurgedError } from "@/lib/children/errors";
import { lockChildForShare } from "@/lib/children/lock";
import type { ChildSafetyInfoInput } from "@/lib/children/safety-info/validation";
import { ChildNotFoundError } from "@/lib/reservations/errors";

type UpsertChildSafetyInfoInput = { childId: string; safetyInfo: ChildSafetyInfoInput; actorUserId: string };

/**
 * 이미 열린 트랜잭션 안에서 아이 안전정보를 저장한다. 동시성 검증(E2E)도 이 함수를 쓴다.
 * Child 행을 FOR SHARE 로 잠근 뒤 파기 여부를 판정하므로(ADR-058), 보관기간 만료 파기와 동시에 실행돼도
 * 파기된 아이에게 안전정보가 다시 생기지 않는다 — 파기가 먼저면 여기서 막고, 여기가 먼저면 파기가 이 행까지 삭제한다.
 */
export async function upsertChildSafetyInfoInTransaction(
  tx: Prisma.TransactionClient,
  input: UpsertChildSafetyInfoInput,
): Promise<void> {
  const child = await lockChildForShare(tx, input.childId);
  if (!child) throw new ChildNotFoundError();
  if (child.personalDataPurgedAt) throw new ChildPersonalDataPurgedError();

  await tx.childSafetyInfo.upsert({
    where: { childId: input.childId },
    create: { childId: input.childId, ...input.safetyInfo, updatedById: input.actorUserId },
    update: { ...input.safetyInfo, updatedById: input.actorUserId },
  });
}

/** 인증·입력 검증이 끝난 뒤 action 이 호출한다. */
export async function upsertChildSafetyInfoCore(
  client: Pick<PrismaClient, "$transaction">,
  input: UpsertChildSafetyInfoInput,
): Promise<void> {
  await client.$transaction((tx) => upsertChildSafetyInfoInTransaction(tx, input));
}
