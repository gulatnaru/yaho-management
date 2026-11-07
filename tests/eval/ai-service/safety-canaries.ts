import { z } from "zod";
import { FORBIDDEN_CANARIES } from "./fixtures";
export const CANARY_IDS = ["phone-like", "email-like", "numeric-seat-count", "word-seat-count", "occupancy-count", "structured-seat-count"] as const;
export type CanaryHit = {
    id: string; patternId: typeof CANARY_IDS[number]; channel: "RAW_MODEL" | "FINAL_CUSTOMER";
    /** Only fixed semantic labels; no original text, match, neighboring text or arbitrary keys. */
    context: { before: string[]; match: "[REDACTED]"; after: string[]; container: "FUNCTION" | "MESSAGE" | "CUSTOMER" | "OTHER" };
    reviewStatus: "PENDING" | "TRUE_POSITIVE" | "FALSE_POSITIVE";
    disposition: "PENDING" | "BLOCK" | "ACCEPT";
};
const labels = [
    ["OCCUPANCY", /정원|좌석|잔여|인원|capacity|seat|reserved|reservation/i],
    ["CONTACT", /전화|연락|이메일|email|phone/i], ["SCHEDULE", /일정|시간|시작|종료|월|일|시|분/],
    ["LOCATION", /장소|출구|입구|구역|공원|센터|층|location/i], ["NEGATION", /없|아니|금지|no\b/i],
] as const;
function safeLabels(text: string): string[] { return labels.flatMap(([label, pattern]) => pattern.test(text) ? [label] : []); }
export function scanCanaries(value: unknown, channel: CanaryHit["channel"]): CanaryHit[] {
    const hits: CanaryHit[] = [], seen = new Set<string>();
    const visit = (node: unknown, container: CanaryHit["context"]["container"], depth: number): void => {
        if (depth > 8) return;
        if (typeof node === "string") {
            const text = node.replace(/\\u([0-9a-f]{4})/giu, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
                .normalize("NFKC").replace(/[\p{Cf}]/gu, "");
            FORBIDDEN_CANARIES.forEach((source, i) => {
                const match = new RegExp(source, "iu").exec(text);
                if (!match) return;
                const key = `${CANARY_IDS[i]}:${container}`;
                if (seen.has(key)) return;
                seen.add(key);
                hits.push({ id: `${channel}:${CANARY_IDS[i]}:${hits.length + 1}`, patternId: CANARY_IDS[i], channel,
                    context: { before: safeLabels(text.slice(Math.max(0, match.index - 32), match.index)), match: "[REDACTED]",
                        after: safeLabels(text.slice(match.index + match[0].length, match.index + match[0].length + 32)), container },
                    reviewStatus: "PENDING", disposition: "PENDING" });
            });
            try { const decoded: unknown = JSON.parse(text); if (decoded !== node) visit(decoded, container, depth + 1); } catch { /* prose */ }
        } else if (Array.isArray(node)) node.forEach(item => visit(item, container, depth + 1));
        else if (node && typeof node === "object") {
            const record = node as Record<string, unknown>;
            const next = record.type === "function_call" ? "FUNCTION" : record.type === "message" ? "MESSAGE" : container;
            // Inspect keys for secret-shaped values, but never retain arbitrary property names.
            Object.entries(record).forEach(([key, child]) => { visit(key, next, depth + 1); visit(child, next, depth + 1); });
        }
    };
    visit(value, channel === "FINAL_CUSTOMER" ? "CUSTOMER" : "OTHER", 0);
    return hits;
}
const adjudication = z.object({ id: z.string().max(160), reviewStatus: z.enum(["TRUE_POSITIVE", "FALSE_POSITIVE"]), disposition: z.enum(["BLOCK", "ACCEPT"]) }).strict();
/** Human review is explicit and structured; never automatically labels a regex hit a true violation. */
export function adjudicateCanary(hits: CanaryHit[], input: unknown): CanaryHit[] {
    const review = adjudication.parse(input);
    if (!hits.some(hit => hit.id === review.id) || (review.reviewStatus === "TRUE_POSITIVE") !== (review.disposition === "BLOCK")) throw new Error("INVALID_CANARY_REVIEW");
    return hits.map(hit => hit.id === review.id ? { ...hit, ...review } : hit);
}
