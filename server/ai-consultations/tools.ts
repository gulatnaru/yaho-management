import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertOwnedLease } from "./ledger";
import {
  AiDenied,
  idSchema,
  SYNTHETIC_GUIDANCE,
  type Scope,
} from "@/lib/ai-consultations/contracts";
export const toolCallSchema = z.discriminatedUnion("name", [
  z
    .object({
      name: z.literal("list_public_programs"),
      args: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal("list_public_classes"),
      args: z.object({ programHandle: idSchema.optional() }).strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal("get_class_availability"),
      args: z.object({ classHandle: idSchema }).strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal("get_approved_guidance"),
      args: z
        .object({ topic: z.enum(["POLICY", "PREPARATION", "RAIN"]) })
        .strict(),
    })
    .strict(),
]);
export type ToolCall = z.infer<typeof toolCallSchema>;
export type PublicProgram = {
  handle: string;
  name: string;
  description: string | null;
  targetAgeMin: number | null;
  targetAgeMax: number | null;
};
export type PublicClass = {
  handle: string;
  programHandle: string;
  startsAt: string;
  endsAt: string;
  location: string;
};
export type Availability = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
export type ToolResult =
  | {
      kind: "PROGRAMS";
      items: PublicProgram[];
    }
  | {
      kind: "CLASSES";
      items: PublicClass[];
    }
  | {
      kind: "AVAILABILITY";
      status: Availability;
    }
  | {
      kind: "GUIDANCE";
      content: string | null;
      version: number | null;
    };
export type Tools = {
  execute: (call: unknown, signal: AbortSignal) => Promise<ToolResult>;
};
export const SYNTHETIC_FACTS = Object.freeze({
  name: "[SYNTHETIC] 야호 숲 프로그램",
  description: "[SYNTHETIC] 숲체험 검증용 프로그램",
  location: "[SYNTHETIC] 테스트 숲",
});
function safeProgram(
  row: {
    id: string;
    name: string;
    description: string | null;
    targetAgeMin: number | null;
    targetAgeMax: number | null;
  },
  scope: Scope,
) {
  if (
    row.name !== SYNTHETIC_FACTS.name ||
    row.description !== SYNTHETIC_FACTS.description ||
    row.targetAgeMin !== 5 ||
    row.targetAgeMax !== 8
  )
    throw new AiDenied();
  return {
    handle: "program-" + (scope.manifest.programIds.indexOf(row.id) + 1),
    name: row.name,
    description: row.description,
    targetAgeMin: row.targetAgeMin,
    targetAgeMax: row.targetAgeMax,
  };
}
function safeLocation(value: string) {
  if (value !== SYNTHETIC_FACTS.location) throw new AiDenied();
  return value;
}
export function publicationWhere(scope: Scope) {
  return { runId: scope.runId, enabled: true };
}
/** Only runner-owned synthetic records are eligible. Private counts never cross this adapter. */
export function createTools(
  client: PrismaClient,
  scope: Scope,
  clock: () => Date = () => new Date(),
): Tools {
  const classWhere = () => ({
    id: { in: scope.manifest.classIds },
    programId: { in: scope.manifest.programIds },
    status: "SCHEDULED" as const,
    startsAt: { gt: clock() },
    aiPublications: { some: publicationWhere(scope) },
    program: {
      status: "ACTIVE" as const,
      aiPublications: { some: publicationWhere(scope) },
    },
  });
  return {
    async execute(value, signal) {
      const call = toolCallSchema.parse(value);
      if (signal.aborted) throw new AiDenied();
      try {
        return await client.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL statement_timeout = '180ms'`;
            await tx.$executeRaw`SET LOCAL lock_timeout = '50ms'`;
            await assertOwnedLease(tx, scope, clock());
            if (signal.aborted) throw new AiDenied();
            let result: ToolResult;
            if (call.name === "list_public_programs") {
              const rows = await tx.program.findMany({
                where: {
                  id: { in: scope.manifest.programIds },
                  status: "ACTIVE",
                  aiPublications: { some: publicationWhere(scope) },
                },
                select: {
                  id: true,
                  name: true,
                  description: true,
                  targetAgeMin: true,
                  targetAgeMax: true,
                },
                orderBy: { id: "asc" },
                take: 20,
              });
              result = {
                kind: "PROGRAMS",
                items: rows.map((x) => safeProgram(x, scope)),
              };
            } else if (call.name === "list_public_classes") {
              const programId =
                call.args.programHandle &&
                /^program-[1-9][0-9]*$/.test(call.args.programHandle)
                  ? scope.manifest.programIds[
                      Number(call.args.programHandle.slice(8)) - 1
                    ]
                  : undefined;
              if (call.args.programHandle && !programId) throw new AiDenied();
              const rows = await tx.classSchedule.findMany({
                where: { ...classWhere(), ...(programId ? { programId } : {}) },
                select: {
                  id: true,
                  programId: true,
                  startsAt: true,
                  endsAt: true,
                  location: true,
                },
                orderBy: { startsAt: "asc" },
                take: 40,
              });
              result = {
                kind: "CLASSES",
                items: rows.map((x) => ({
                  handle:
                    "class-" + (scope.manifest.classIds.indexOf(x.id) + 1),
                  programHandle:
                    "program-" +
                    (scope.manifest.programIds.indexOf(x.programId) + 1),
                  startsAt: x.startsAt.toISOString(),
                  endsAt: x.endsAt.toISOString(),
                  location: safeLocation(x.location),
                })),
              };
            } else if (call.name === "get_class_availability") {
              const classId = /^class-[1-9][0-9]*$/.test(call.args.classHandle)
                ? scope.manifest.classIds[
                    Number(call.args.classHandle.slice(6)) - 1
                  ]
                : undefined;
              if (!classId) return { kind: "AVAILABILITY", status: "UNKNOWN" };
              try {
                const row = await tx.classSchedule.findFirst({
                  where: { ...classWhere(), id: classId },
                  select: {
                    capacity: true,
                    _count: {
                      select: {
                        reservations: { where: { status: "RESERVED" } },
                      },
                    },
                  },
                });
                result = {
                  kind: "AVAILABILITY",
                  status: row
                    ? row._count.reservations < row.capacity
                      ? "AVAILABLE"
                      : "UNAVAILABLE"
                    : "UNKNOWN",
                };
              } catch {
                result = { kind: "AVAILABILITY", status: "UNKNOWN" };
              }
            } else {
              const row = await tx.aiKnowledgeEntry.findUnique({
                where: {
                  runId_topic: { runId: scope.runId, topic: call.args.topic },
                },
                select: { approved: true, content: true, version: true },
              });
              result = {
                kind: "GUIDANCE",
                content:
                  row?.approved &&
                  row.content === SYNTHETIC_GUIDANCE[call.args.topic]
                    ? row.content
                    : null,
                version:
                  row?.approved &&
                  row.content === SYNTHETIC_GUIDANCE[call.args.topic]
                    ? row.version
                    : null,
              };
            }
            if (signal.aborted) throw new AiDenied();
            return result;
          },
          { maxWait: 40, timeout: 250 },
        );
      } catch {
        if (call.name === "get_class_availability")
          return { kind: "AVAILABILITY", status: "UNKNOWN" };
        throw new AiDenied();
      }
    },
  };
}
