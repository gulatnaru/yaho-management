import type { Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { ChildPersonalDataPurgedError } from "@/lib/children/errors";
import { lockChildForShare } from "@/lib/children/lock";
import type { childConsentInputSchema } from "@/lib/children/consent/validation";
import { ChildNotFoundError } from "@/lib/reservations/errors";

export type ChildConsentRecordInput = z.infer<typeof childConsentInputSchema>;

type RecordChildConsentInput = { childId: string; consent: ChildConsentRecordInput; actorUserId: string };

/**
 * 이미 열린 트랜잭션 안에서 동의 이력을 append-only 로 추가한다(ADR-008). 동시성 검증(E2E)도 이 함수를 쓴다.
 * Child 행을 FOR SHARE 로 잠근 뒤 파기 여부를 판정하므로(ADR-058), 보관기간 만료 파기와 동시에 실행돼도
 * 파기된 아이에게 동의 이력이 새로 남지 않는다 — 파기가 먼저면 여기서 막고, 여기가 먼저면 파기가 이 행까지 삭제한다.
 */
export async function recordChildConsentInTransaction(
  tx: Prisma.TransactionClient,
  input: RecordChildConsentInput,
): Promise<void> {
  const child = await lockChildForShare(tx, input.childId);
  if (!child) throw new ChildNotFoundError();
  if (child.personalDataPurgedAt) throw new ChildPersonalDataPurgedError();

  await tx.childConsent.create({
    data: { childId: input.childId, ...input.consent, recordedById: input.actorUserId },
  });
}

/** 인증·입력 검증이 끝난 뒤 action 이 호출한다. */
export async function recordChildConsentCore(
  client: Pick<PrismaClient, "$transaction">,
  input: RecordChildConsentInput,
): Promise<void> {
  await client.$transaction((tx) => recordChildConsentInTransaction(tx, input));
}
