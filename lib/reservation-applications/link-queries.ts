import "server-only";
import { linkRevision, readClassLinkRevision } from "@/server/reservation-applications/groups";
import { z } from "zod";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { formatKstDateTime, formatKstDateTimeRange } from "@/lib/classes/datetime";
import { canIssueApplicationLink, getLinkReadiness, type LinkReadiness } from "./availability";
import { buildModeApplicationAvailabilityContext } from "./runtime";

const LINK_SELECT = {
  id: true, token: true, isActive: true, issuedAt: true, updatedAt: true,
  issuedBy: { select: { name: true } },
} as const;

export type ClassLinkScope = {
  id: string;
  label: "이 클래스 전용" | "기존 주소를 전환한 링크" | "여러 클래스 통합";
  groupId: string | null;
  revision?: string;
  scopeActive: boolean;
  currentClassMember: boolean;
  /** Record/scope activity and membership only; intake and environment stay independent. */
  activeForCurrentClass: boolean;
  upgraded: boolean;
  members: { id: string; label: string; revision?: string }[];
  links: { id: string; isActive: boolean; issuedAtLabel: string; issuedByName: string; rawPath: string | null }[];
  readiness: LinkReadiness;
};
export type ClassApplicationLinksView = {
  classScheduleId: string;
  className: string;
  timeLabel: string;
  applicationPrice: number | null;
  priceRevision?: string;
  revision?: string;
  canIssue: boolean;
  environment: LinkReadiness["environment"];
  publicAccessAllowed: boolean;
  unissuedReadiness: LinkReadiness;
  scopes: ClassLinkScope[];
};

/** All scopes, never a most-recent winner. Raw hashes never leave the database. */
export async function getClassApplicationLinks(classScheduleId: string): Promise<ClassApplicationLinksView | null> {
  await requireAdminPrincipal();
  const id = z.string().min(1).max(200).parse(classScheduleId);
  const now = new Date();
  const [classSchedule, directLinks, groups, settings] = await Promise.all([
    prisma.classSchedule.findUnique({ where: { id }, select: {
      id: true, status: true, startsAt: true, endsAt: true, applicationPrice: true, updatedAt: true, program: { select: { name: true } },
    } }),
    prisma.reservationApplicationLink.findMany({ where: { classScheduleId: id }, select: LINK_SELECT, orderBy: [{ issuedAt: "desc" }, { id: "asc" }] }),
    prisma.reservationApplicationGroup.findMany({
      where: { OR: [{ classes: { some: { classScheduleId: id } } }, { upgradedLegacyClassScheduleId: id }] },
      select: { id: true, isActive: true, updatedAt: true, upgradedLegacyClassScheduleId: true, syntheticSettings: true, syntheticRunId: true,
        classes: { select: { classScheduleId: true, classSchedule: { select: { id: true, startsAt: true, program: { select: { name: true } } } } }, orderBy: { classScheduleId: "asc" } },
        links: { select: LINK_SELECT, orderBy: [{ issuedAt: "desc" }, { id: "asc" }] },
      }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.reservationApplicationSettings.findUnique({ where: { id: 1 }, select: {
      bankName: true, accountNumber: true, accountHolder: true, blogUrl: true, instagramUrl: true, kakaoChannelUrl: true,
    } }),
  ]);
  if (!classSchedule) return null;
  const upgraded = groups.find((group) => group.upgradedLegacyClassScheduleId === id);
  const readiness = (modern: boolean, scopeActive: boolean, links: { isActive: boolean }[], syntheticSettings?: unknown, syntheticRunId?: string | null) => getLinkReadiness({
    links, scopeActive, classSchedule, modern,
    context: buildModeApplicationAvailabilityContext(modern ? "modern" : "legacy", settings, now, process.env, syntheticSettings),
    vercelEnv: process.env.VERCEL_ENV, syntheticRunId,
  });
  const projectLinks = (links: typeof directLinks, allowRaw: boolean) => links.map((link) => ({
    id: link.id, isActive: link.isActive, issuedAtLabel: formatKstDateTime(link.issuedAt), issuedByName: link.issuedBy.name,
    // Only the compatibility legacy address has stored plaintext. Never derive an address from a hash.
    rawPath: allowRaw && link.isActive && link.token ? `/apply/${encodeURIComponent(link.token)}` : null,
  }));
  const scopes: ClassLinkScope[] = [];
  if (directLinks.length) {
    const member = !upgraded || upgraded.classes.some((item) => item.classSchedule.id === id);
    const scopeActive = upgraded?.isActive ?? true;
    scopes.push({ id: `class:${id}`, label: upgraded ? "기존 주소를 전환한 링크" : "이 클래스 전용", groupId: upgraded?.id ?? null,
      upgraded: Boolean(upgraded), scopeActive, currentClassMember: member,
      activeForCurrentClass: member && scopeActive && directLinks.some((link) => link.isActive),
      members: upgraded ? upgraded.classes.map(({ classSchedule: item }) => ({ id: item.id, label: `${item.program.name} · ${formatKstDateTime(item.startsAt)}` })) : [{ id, label: classSchedule.program.name }],
      links: projectLinks(directLinks, scopeActive && member),
      readiness: readiness(Boolean(upgraded), scopeActive, directLinks, upgraded?.syntheticSettings, upgraded?.syntheticRunId),
    });
  }
  for (const group of groups) {
    const member = group.classes.some((item) => item.classSchedule.id === id);
    scopes.push({ id: `group:${group.id}`, label: group.upgradedLegacyClassScheduleId !== null ? "기존 주소를 전환한 링크" : group.classes.length > 1 ? "여러 클래스 통합" : "이 클래스 전용",
      groupId: group.id, revision: linkRevision({ id: group.id, isActive: group.isActive, updatedAt: group.updatedAt, classes: group.classes.map((row) => ({ classScheduleId: row.classScheduleId ?? row.classSchedule.id })).sort((a,b) => a.classScheduleId.localeCompare(b.classScheduleId)), links: group.links.map((row) => ({ id: row.id, isActive: row.isActive, updatedAt: row.updatedAt })).sort((a,b) => a.id.localeCompare(b.id)) }), upgraded: group.upgradedLegacyClassScheduleId !== null, scopeActive: group.isActive,
      currentClassMember: member, activeForCurrentClass: member && group.isActive && group.links.some((link) => link.isActive),
      members: await Promise.all(group.classes.map(async ({ classSchedule: item }) => ({ id: item.id, label: `${item.program.name} · ${formatKstDateTime(item.startsAt)}`, revision: await readClassLinkRevision(prisma, item.id) }))),
      links: projectLinks(group.links, false),
      readiness: readiness(true, group.isActive, group.links, group.syntheticSettings, group.syntheticRunId),
    });
  }
  const empty = readiness(true, true, []);
  return { classScheduleId: id, className: classSchedule.program.name, timeLabel: formatKstDateTimeRange(classSchedule.startsAt, classSchedule.endsAt), applicationPrice: classSchedule.applicationPrice,
    priceRevision: classSchedule.updatedAt?.toISOString(), revision: await readClassLinkRevision(prisma, id), canIssue: canIssueApplicationLink(classSchedule, now), environment: empty.environment, publicAccessAllowed: empty.publicAccessAllowed, unissuedReadiness: empty, scopes };
}


export type LinkCompositionOption = { id: string; label: string; applicationPrice: number | null; eligible: boolean; revision: string };
export async function getLinkCompositionOptions(currentClassId?: string): Promise<LinkCompositionOption[]> {
  await requireAdminPrincipal();
  const now = new Date();
  const id = z.string().min(1).max(200).optional().parse(currentClassId);
  const select = { id: true, status: true, startsAt: true, applicationPrice: true, program: { select: { name: true } } } as const;
  const [rows, current] = await Promise.all([
    prisma.classSchedule.findMany({ where: { status: "SCHEDULED", startsAt: { gt: now } }, select, orderBy: { startsAt: "asc" }, take: 100 }),
    id ? prisma.classSchedule.findUnique({ where: { id }, select }) : Promise.resolve(null),
  ]);
  // The class being managed must remain selected even outside the first page of
  // future classes; a closed current class remains visible but cannot be issued.
  if (current && !rows.some((row) => row.id === current.id)) rows.unshift(current);
  return Promise.all(rows.map(async (row) => ({ id: row.id, label: `${row.program.name} · ${formatKstDateTime(row.startsAt)}`, applicationPrice: row.applicationPrice, eligible: canIssueApplicationLink(row, now) && Boolean(row.applicationPrice && row.applicationPrice > 0), revision: await readClassLinkRevision(prisma, row.id) })));
}
