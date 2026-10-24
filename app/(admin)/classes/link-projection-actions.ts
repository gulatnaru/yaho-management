"use server";

import { z } from "zod";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { getClassApplicationLinks, getLinkCompositionOptions } from "@/lib/reservation-applications/link-queries";
import { readClassLinkRevision } from "@/server/reservation-applications/groups";
import { canIssueApplicationLink } from "@/lib/reservation-applications/availability";

const recordId = z.string().min(1).max(200);

/** Read without path revalidation: synchronize the card without another route Flight commit. */
export async function readClassLinkProjection(input: unknown) {
  await requireAdminPrincipal();
  const classScheduleId = recordId.parse(input);
  const [view, options] = await Promise.all([
    getClassApplicationLinks(classScheduleId),
    getLinkCompositionOptions(classScheduleId),
  ]);
  return { view, options };
}

/** Only active record identities leave this read; modern plaintext remains in the receipt. */
export async function readGroupLinkProjection(input: unknown) {
  await requireAdminPrincipal();
  const groupId = recordId.parse(input);
  const group = await prisma.reservationApplicationGroup.findUnique({
    where: { id: groupId },
    select: { isActive: true, links: { where: { isActive: true }, select: { id: true } }, classes: { select: { classScheduleId: true, classSchedule: { select: { status: true, startsAt: true, applicationPrice: true } } } } },
  });
  const now = new Date();
  const members = Object.fromEntries(await Promise.all((group?.classes ?? []).map(async ({ classScheduleId, classSchedule }) => [classScheduleId, {
    revision: await readClassLinkRevision(prisma, classScheduleId),
    applicationPrice: classSchedule.applicationPrice,
    eligible: canIssueApplicationLink(classSchedule, now) && Boolean(classSchedule.applicationPrice && classSchedule.applicationPrice > 0),
  }] as const)));
  return { groupId, activeLinkIds: group?.isActive ? group.links.map((link) => link.id) : [], members };
}
