import type { PrismaClient } from "@prisma/client";
import { reservationApplicationSettingsSchema } from "@/lib/reservation-applications/phase20-validation";
import { readPublicApplicationConfig } from "@/lib/reservation-applications/config";

type SettingsClient = Pick<PrismaClient, "reservationApplicationSettings">;

export async function getReservationApplicationSettings(client: SettingsClient) {
  return client.reservationApplicationSettings.findUnique({
    where: { id: 1 },
    select: { bankName: true, accountNumber: true, accountHolder: true, blogUrl: true, instagramUrl: true, kakaoChannelUrl: true, updatedAt: true },
  });
}

/** A present but invalid row is authoritative and closes new priced intake; callers must not fall back to env. */
export function isReservationApplicationSettingsReady(value: unknown): boolean {
  return reservationApplicationSettingsSchema.safeParse(value).success;
}

export async function saveReservationApplicationSettingsCore(
  client: SettingsClient,
  input: { values: unknown; actorUserId: string },
) {
  const values = reservationApplicationSettingsSchema.parse(input.values);
  return client.reservationApplicationSettings.upsert({
    where: { id: 1 },
    create: { id: 1, ...values, updatedById: input.actorUserId },
    update: { ...values, updatedById: input.actorUserId },
    select: { id: true, updatedAt: true },
  });
}

/** One explicit ADMIN-only migration path. It never overwrites a database-owned setting row. */
export async function importLegacyReservationApplicationSettingsCore(
  client: SettingsClient,
  input: { actorUserId: string; environment?: NodeJS.ProcessEnv },
): Promise<boolean> {
  const existing = await client.reservationApplicationSettings.findUnique({ where: { id: 1 }, select: { id: true } });
  if (existing) return false;
  const legacy = readPublicApplicationConfig(input.environment);
  if (!legacy) return false;
  await client.reservationApplicationSettings.create({
    data: {
      id: 1,
      bankName: legacy.bankName,
      accountNumber: legacy.bankAccountNumber,
      accountHolder: legacy.bankAccountHolder,
      blogUrl: legacy.blogUrl,
      instagramUrl: legacy.instagramUrl,
      kakaoChannelUrl: legacy.kakaoChannelUrl,
      updatedById: input.actorUserId,
    },
  });
  return true;
}
