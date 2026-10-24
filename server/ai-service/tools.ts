import { safePublicText } from "./public-text";
export { safePublicText } from "./public-text";
import { programDigest, classDigest, type ClassSource } from "./publication-digest";
import { z } from "zod";
import { parse, ServiceDenied, toolCallSchema, type Environment, type ToolCall, HANDOFF } from "./contracts";
import { transaction, type Database } from "./repository";
const program = z.object({ handle: z.string(), name: z.string().max(120), description: z.string().max(400).nullable() }).strict();
const schedule = z.object({ handle: z.string(), programHandle: z.string(), startsAt: z.string().datetime(), endsAt: z.string().datetime(), location: z.string().max(120) }).strict();
const SOURCE_CAPACITY = 20;
/** Read one overflow sentinel; never turn a bounded prefix into an approved catalog. */
function completeSources<T>(rows: T[]): T[] {
    if (rows.length > SOURCE_CAPACITY)
        throw new ServiceDenied();
    return rows;
}
export const resultSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("PROGRAMS"), items: z.array(program).max(SOURCE_CAPACITY) }).strict(),
    z.object({ kind: z.literal("CLASSES"), items: z.array(schedule).max(SOURCE_CAPACITY) }).strict(),
    z.object({ kind: z.literal("AVAILABILITY"), status: z.enum(["AVAILABLE", "UNAVAILABLE", "UNKNOWN"]) }).strict(),
    z.object({ kind: z.literal("GUIDANCE"), content: z.string().max(1000).nullable() }).strict(),
]);
export type ToolResult = z.infer<typeof resultSchema>;
export interface Tools {
    execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult>;
}
export function createTools(db: Database, environment: Environment, clock: () => Date = () => new Date()): Tools {
    return { async execute(input, signal) {
            const call = parse(toolCallSchema, input);
            if (signal.aborted)
                throw new ServiceDenied();
            return transaction(db, environment, async (tx) => {
                // Check all enabled approvals before freshness filtering or target narrowing.
                // Even stale enabled overflow fails closed; it is never silently skipped.
                const approvals = completeSources(await tx.aiServiceProgramPublication.findMany({ where: { environment, enabled: true }, take: SOURCE_CAPACITY + 1 }));
                const sources = completeSources(await tx.program.findMany({ where: { id: { in: approvals.map(p => p.programId) }, status: "ACTIVE" },
                    select: { id: true, name: true, description: true, status: true, updatedAt: true }, orderBy: { id: "asc" }, take: SOURCE_CAPACITY + 1 }));
                const programs = approvals.filter(p => sources.some(r => r.id === p.programId && +r.updatedAt === +p.sourceUpdatedAt && programDigest(r) === p.sourceDigest));
                const programIds = programs.map(p => p.programId), programHandle = (id: string) => programs.find(p => p.programId === id)?.id;
                const publications = completeSources(await tx.aiServiceClassPublication.findMany({ where: { environment, enabled: true }, take: SOURCE_CAPACITY + 1 }));
                const classesWhere = { id: { in: publications.map(p => p.classScheduleId) }, programId: { in: programIds },
                    status: "SCHEDULED" as const, startsAt: { gt: clock() }, program: { status: "ACTIVE" as const, OR: sources.filter(r => programIds.includes(r.id)).map(r => ({ id: r.id, name: r.name, description: r.description, updatedAt: r.updatedAt })) } };
                const validClass = (r: ClassSource & {
                    updatedAt: Date;
                }) => publications.some(p => p.classScheduleId === r.id && +p.sourceUpdatedAt === +r.updatedAt && classDigest(r) === p.sourceDigest);
                let result: ToolResult;
                if (call.name === "list_public_programs") {
                    result = { kind: "PROGRAMS", items: sources.filter(r => programIds.includes(r.id)).map(r => ({ handle: programHandle(r.id)!,
                            name: safePublicText(r.name, 120), description: r.description ? safePublicText(r.description, 400) : null })) };
                }
                else if (call.name === "list_public_classes") {
                    const programId = call.args.programHandle ? programs.find(p => p.id === call.args.programHandle)?.programId : undefined;
                    if (call.args.programHandle && !programId)
                        throw new ServiceDenied();
                    const rows = completeSources(await tx.classSchedule.findMany({ where: { ...classesWhere, ...(programId ? { programId } : {}) },
                        select: { id: true, programId: true, startsAt: true, endsAt: true, location: true, status: true, updatedAt: true }, orderBy: { startsAt: "asc" }, take: SOURCE_CAPACITY + 1 }));
                    result = { kind: "CLASSES", items: rows.filter(validClass).map(r => ({ handle: publications.find(p => p.classScheduleId === r.id)!.id, programHandle: programHandle(r.programId)!,
                            startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(), location: safePublicText(r.location, 120, "LOCATION") })) };
                }
                else if (call.name === "get_class_availability") {
                    const id = publications.find(p => p.id === call.args.classHandle)?.classScheduleId;
                    const row = id ? await tx.classSchedule.findFirst({ where: { ...classesWhere, id },
                        select: { id: true, programId: true, startsAt: true, endsAt: true, location: true, status: true, updatedAt: true,
                            capacity: true, _count: { select: { reservations: { where: { status: "RESERVED" } } } } } }) : null;
                    result = { kind: "AVAILABILITY", status: row && validClass(row) ? (row._count.reservations < row.capacity ? "AVAILABLE" : "UNAVAILABLE") : "UNKNOWN" };
                }
                else {
                    const row = await tx.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment, topic: call.args.topic } } });
                    result = { kind: "GUIDANCE", content: row?.approved ? safePublicText(row.content) : null };
                }
                if (signal.aborted)
                    throw new ServiceDenied();
                return parse(resultSchema, result);
            });
        } };
}
/** Only typed server facts are formatted; model prose is never accepted. */
export function groundedReply(value: unknown) {
    const result = parse(resultSchema, value);
    let text: string;
    if (result.kind === "PROGRAMS")
        text = result.items.map(p => safePublicText(p.name, 120) + (p.description ? " — " + safePublicText(p.description, 400) : "")).join("\n");
    else if (result.kind === "CLASSES")
        text = result.items.map(c => new Date(c.startsAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " " + safePublicText(c.location, 120, "LOCATION")).join("\n");
    else if (result.kind === "GUIDANCE")
        text = result.content ? safePublicText(result.content) : HANDOFF;
    else
        text = result.status === "AVAILABLE" ? "현재 신청 가능한 일정입니다. 예약 확정은 담당자 확인이 필요합니다." : result.status === "UNAVAILABLE" ? "현재 신청이 어려운 일정입니다. 담당자에게 문의해 주세요." : HANDOFF;
    return text && text.length <= 1000 ? text : HANDOFF;
}
