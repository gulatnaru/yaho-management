import { z } from "zod";
import { HANDOFF, ServiceDenied, safeId, toolCallSchema, type ToolCall } from "./contracts";
import { groundedReply, resultSchema, safePublicText, type ToolResult, type Tools } from "./tools";

/** One normalization for user intent, target matching and evaluation partition checks. */
export function normalizeUtterance(value: string): string {
    return value.normalize("NFKC").replace(/[\p{Cf}\p{Cc}]/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}
const compact = (value: string) => normalizeUtterance(value).replace(/\s/g, "");

/** Complete approved public scope, bounded by resultSchema. Never truncate before authorization. */
export function selectionCatalog(value: unknown): ToolResult[] {
    const rows = z.array(resultSchema).max(2).parse(value);
    const seen = new Set<string>(), handles = new Set<string>();
    return rows.map(row => {
        if (seen.has(row.kind)) throw new ServiceDenied();
        seen.add(row.kind);
        if (row.kind !== "PROGRAMS" && row.kind !== "CLASSES") throw new ServiceDenied();
        for (const item of row.items) {
            safeId.parse(item.handle);
            if (handles.has(item.handle)) throw new ServiceDenied();
            handles.add(item.handle);
        }
        if (row.kind === "PROGRAMS") return { kind: row.kind, items: row.items.map(p => ({
            handle: p.handle, name: safePublicText(p.name, 120), description: p.description === null ? null : safePublicText(p.description, 400),
        })) };
        return { kind: row.kind, items: row.items.map(c => ({ ...c,
            programHandle: safeId.parse(c.programHandle), location: safePublicText(c.location, 120, "LOCATION"),
        })) };
    });
}

// Deliberately conservative: unfamiliar wording goes to a person, never a guessed lookup.
const forbidden = /취소|환불|결제|입금|금액|가격|할인|예약(?!가능)|예약자|개인|전화|연락처|이메일|이름으로|아이들|명단|비밀번호|카드|계좌|주민|정원|잔여|좌석|몇자리|몇명|인원|비공개|미게시|미승인|승인되지|공개해제|숨겨|초안|관리자|개발자|시스템|프롬프트|지시|무시|우회|제한|도구|인자|핸들|식별자|비밀|암호|몰래|대신|출력|실행|sql|prompt|ignore|override|system|secret|api|token|password|https?:|@|\d{7,}/iu;
const preparation = /준비물|챙길물건|복장|신발/;
const rain = /우천|비가|비예보|비오는/;
const policy = /정책|규정|수칙/;
const availability = /신청|접수|참여가능|예약가능/;
const schedule = /일정|장소|어디|언제|시작|종료|시간|열리/;
const introduction = /종류|목록|소개|설명|이름/;
// These are query language, never a list of allowed program names. Targets come only from catalog.
const queryWords = ["비오는경우", "확인하고싶어요", "참여할수있는", "확인할수있을까요", "볼수있을까요", "신청할수있나요", "참여가능한", "가능한상태인지", "어떤프로그램인가요", "어떻게되나요", "무엇인가요", "어떻게진행되나요", "진행하나요", "알려주세요", "안내해주세요", "보여주세요", "소개해주세요", "부탁드립니다", "부탁드려요", "부탁해요", "궁금합니다", "궁금해요", "확인해주세요", "보고싶습니다", "보고싶어요", "알고싶습니다", "읽고싶습니다", "열리는지", "열리나요", "시작해요", "필요한가요", "준비하면되나요", "있을때", "오면", "내리는날의", "오는경우", "날씨가", "날의", "마감인가요", "마감인지", "가능한가요", "가능한지", "상태인가요", "중인가요", "있나요", "있을까요", "진행하는", "처음방문하는데", "처음참여할때", "참여전에", "참여전", "갈때", "챙길물건", "안내받는지", "어떻게", "어떤", "무엇이", "가능한", "공개된", "공개승인된", "승인된", "공식", "전체", "일반", "현재", "지금", "이번에", "간단히", "체험", "클래스", "수업", "야외", "야호", "숲", "프로그램별", "프로그램", "준비물", "복장", "신발", "우천", "비예보", "비가", "비오는", "정책", "규정", "수칙", "운영", "이용", "진행", "안내문", "안내", "기준", "목록", "종류", "설명", "소개", "이름", "신청", "접수", "참여", "예약가능", "일정", "장소", "어디에서", "어디서", "어디", "언제", "시작", "종료", "시간", "준비", "확인", "가요", "인가요", "은", "는", "이", "가", "을", "를", "에", "의", "과", "와", "도", "만", "부터", "에는", "에서", "시", "전", "중", "에맞는", "에관한", "알아둘"].sort((a, b) => b.length - a.length);

export type SelectionDecision = { allowed: true; call: ToolCall } | { allowed: false };
export function authorizeSelection(utterance: string, selected: unknown, catalog: unknown): SelectionDecision {
    try {
        const call = toolCallSchema.parse(selected), bounded = selectionCatalog(catalog);
        const programs = bounded.flatMap(row => row.kind === "PROGRAMS" ? row.items : []);
        const classes = bounded.flatMap(row => row.kind === "CLASSES" ? row.items : []);
        const q = compact(z.string().min(1).max(1000).parse(utterance));
        if (forbidden.test(q)) return { allowed: false };
        let rest = q;
        const mentionedPrograms = new Set<string>(), mentionedClasses = new Set<string>();
        // Longest aliases first; equal names remain ambiguous and are rejected below.
        const aliases = programs.flatMap(p => [...new Set([compact(p.name), compact(p.name).replace(/^합성/, ""), compact(p.handle)])]
            .filter(alias => alias.length >= 2).map(alias => ({ alias, handle: p.handle })));
        for (const { alias, handle } of aliases.sort((a, b) => b.alias.length - a.alias.length)) {
            if (q.includes(alias)) mentionedPrograms.add(handle);
            rest = rest.split(alias).join("");
        }
        for (const c of classes) if (q.includes(compact(c.handle))) {
            mentionedClasses.add(c.handle); rest = rest.split(compact(c.handle)).join("");
        }
        const days = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
        const requestedDays = days.filter(day => q.includes(day));
        if (mentionedPrograms.size > 1 || mentionedClasses.size > 1 || requestedDays.length > 1) return { allowed: false };
        for (const day of requestedDays) rest = rest.split(day).join("");
        // Any unknown target, command, extra topic, negation or unsupported date survives this grammar.
        for (const word of queryWords) rest = rest.split(word).join("");
        if (rest.replace(/[?.!,。？！、:;"'()]/gu, "")) return { allowed: false };
        const topics = [preparation.test(q) && "PREPARATION", rain.test(q) && "RAIN", policy.test(q) && "POLICY"].filter(Boolean);
        const hasAvailability = availability.test(q), hasSchedule = schedule.test(q);
        const requestedProgram = [...mentionedPrograms][0];
        if (topics.length) {
            if (topics.length !== 1 || hasAvailability || hasSchedule || introduction.test(q)) return { allowed: false };
            return call.name === "get_approved_guidance" && call.args.topic === topics[0] ? { allowed: true, call } : { allowed: false };
        }
        if (hasAvailability) {
            if (introduction.test(q) || call.name !== "get_class_availability") return { allowed: false };
            const candidates = classes.filter(c => (!requestedProgram || c.programHandle === requestedProgram)
                && (!mentionedClasses.size || mentionedClasses.has(c.handle))
                && (!requestedDays.length || requestedDays.includes(days[new Date(new Date(c.startsAt).getTime() + 9 * 3600000).getUTCDay()])));
            // Never infer a target merely because the catalog happens to have one item.
            return (requestedProgram || mentionedClasses.size || requestedDays.length) && candidates.length === 1 && candidates[0].handle === call.args.classHandle
                ? { allowed: true, call } : { allowed: false };
        }
        if (hasSchedule) {
            if (/종류|소개|설명|이름/.test(q) || mentionedClasses.size || requestedDays.length) return { allowed: false };
            return call.name === "list_public_classes" && call.args.programHandle === (requestedProgram ?? null)
                ? { allowed: true, call } : { allowed: false };
        }
        return /프로그램/.test(q) && !requestedDays.length && !mentionedClasses.size && call.name === "list_public_programs"
            ? { allowed: true, call } : { allowed: false };
    } catch { return { allowed: false }; }
}

/** Shared customer response boundary. Used again for the post-settlement freshness read. */
export async function executeSelection(utterance: string, selected: unknown, catalog: unknown, tools: Tools, signal: AbortSignal) {
    const decision = authorizeSelection(utterance, selected, catalog);
    if (!decision.allowed || signal.aborted) return { text: HANDOFF, category: "HUMAN_HANDOFF", policyRejected: selected !== null };
    try {
        const facts = await tools.execute(decision.call, signal);
        if (signal.aborted) throw new ServiceDenied();
        const expectedKind = { list_public_programs: "PROGRAMS", list_public_classes: "CLASSES", get_class_availability: "AVAILABILITY", get_approved_guidance: "GUIDANCE" }[decision.call.name];
        if (facts.kind !== expectedKind) throw new ServiceDenied();
        const parsed = resultSchema.parse(facts);
        const bounded = selectionCatalog(catalog);
        const programs = bounded.flatMap(row => row.kind === "PROGRAMS" ? row.items : []);
        const classes = bounded.flatMap(row => row.kind === "CLASSES" ? row.items : []);
        if (parsed.kind === "PROGRAMS" && parsed.items.some(p => !programs.some(approved => approved.handle === p.handle && approved.name === p.name && approved.description === p.description))) throw new ServiceDenied();
        if (parsed.kind === "CLASSES" && parsed.items.some(c => !classes.some(approved => approved.handle === c.handle && approved.programHandle === c.programHandle && approved.startsAt === c.startsAt && approved.endsAt === c.endsAt && approved.location === c.location)
            || decision.call.name === "list_public_classes" && decision.call.args.programHandle !== null && c.programHandle !== decision.call.args.programHandle)) throw new ServiceDenied();
        const text = groundedReply(parsed);
        return { text, category: text === HANDOFF ? "HUMAN_HANDOFF" : facts.kind, policyRejected: false };
    } catch { return { text: HANDOFF, category: "HUMAN_HANDOFF", policyRejected: false }; }
}
