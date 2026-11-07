"use server";
import { prisma } from "@/lib/db/prisma";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { PrismaDispatchRepository } from "@/server/kakao/dispatch-repository";
import { PrismaRuntimeRepository } from "@/server/kakao/runtime-settings";
import { stopNewSends, type BlockResult } from "@/server/kakao/block-action-service";
import { revalidatePath } from "next/cache";

export async function blockAction(_previous: BlockResult | null, form: FormData): Promise<BlockResult> {
  const principal = await requireAdminPrincipal();
  const result = await stopNewSends({ actorId: principal.userId, reason: form.get("reason") }, {
    read: async () => {
      const rows = await prisma.$queryRaw<{ blocked: boolean; revision: number }[]>`SELECT "blocked", "revision" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview'`;
      return rows[0] ?? null;
    },
    repository: new PrismaRuntimeRepository(new PrismaDispatchRepository(prisma)),
  });
  revalidatePath("/reservation-applications/notifications");
  return result;
}
