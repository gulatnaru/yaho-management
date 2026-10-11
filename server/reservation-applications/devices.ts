import type { PrismaClient } from "@prisma/client";
import { hashApplicationCapabilityToken, generateApplicationCapabilityToken } from "@/lib/reservation-applications/token";

export const APPLICATION_DEVICE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export type RepeatDeviceProfile = {
  guardian: {
    guardianName: string;
    guardianPhone: string;
    guardianRelationship: string;
  } | null;
  children: Array<{ id: string; name: string; birthDate: string; gender: string }>;
};

const EMPTY_REPEAT_DEVICE_PROFILE: RepeatDeviceProfile = { guardian: null, children: [] };

/** Issue a fresh device capability after a successful submission. The raw value is cookie-only. */
export async function issueApplicationDeviceCore(
  client: Pick<PrismaClient, "applicationDevice">,
  input: { now: Date; generateToken?: () => string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = (input.generateToken ?? generateApplicationCapabilityToken)();
  const expiresAt = new Date(input.now.getTime() + APPLICATION_DEVICE_TTL_MS);
  await client.applicationDevice.create({ data: { tokenHash: hashApplicationCapabilityToken(token), expiresAt } });
  return { token, expiresAt };
}

/** Fail closed for expiry/revocation. Phone values are never queried or used to grant ownership. */
export async function listOwnedRepeatChildrenCore(
  client: Pick<PrismaClient, "applicationDevice">,
  input: { token: string | undefined; now: Date },
): Promise<RepeatDeviceProfile> {
  if (!input.token) return EMPTY_REPEAT_DEVICE_PROFILE;
  const device = await client.applicationDevice.findFirst({
    where: { tokenHash: hashApplicationCapabilityToken(input.token), revokedAt: null, expiresAt: { gt: input.now } },
    // A device is minted for one submission.  The most recent non-purged
    // submission is the only guardian profile that may be prefilled.  We do
    // not infer ownership from a telephone number or from the Child table.
    select: {
      submissions: {
        where: { submission: { personalDataPurgedAt: null } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { submission: { select: { guardianName: true, guardianPhone: true, guardianRelationship: true } } },
      },
      children: {
        where: { child: { isActive: true, personalDataPurgedAt: null } },
        select: { child: { select: { id: true, name: true, birthDate: true, gender: true, guardianName: true, guardianPhone: true } } },
      },
    },
  });
  const guardian = device?.submissions[0]?.submission;
  if (!device || !guardian?.guardianName || !guardian.guardianPhone || !guardian.guardianRelationship) return EMPTY_REPEAT_DEVICE_PROFILE;
  return {
    guardian: {
      guardianName: guardian.guardianName,
      guardianPhone: guardian.guardianPhone,
      guardianRelationship: guardian.guardianRelationship,
    },
    // A DeviceChild grant alone is insufficient after an administrator changes
    // the Child's guardian. Keep the scope bound to the latest device submission.
    children: device.children
      .filter((row) => row.child.guardianName === guardian.guardianName && row.child.guardianPhone === guardian.guardianPhone)
      .map((row) => ({
        id: row.child.id,
        name: row.child.name,
        birthDate: row.child.birthDate?.toISOString().slice(0, 10) ?? "",
        gender: row.child.gender,
      })),
  };
}

export async function revokeApplicationDeviceCore(client: Pick<PrismaClient, "applicationDevice">, input: { token: string; now: Date }): Promise<boolean> {
  const result = await client.applicationDevice.updateMany({ where: { tokenHash: hashApplicationCapabilityToken(input.token), revokedAt: null }, data: { revokedAt: input.now } });
  return result.count === 1;
}
