import { ServiceDenied } from "./contracts";
export type PublicTextKind = "FREE" | "LOCATION";
export function safePublicText(value: string, max = 1000, kind: PublicTextKind = "FREE") {
    void kind;
    const normalized = value.normalize("NFKC").replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "").normalize("NFKC");
    if (!normalized.trim() || normalized.length > max ||
        /[<>]|https?:|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?82[- ]?)?0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/i.test(normalized) ||
        /ignore.*instructions|system\s*prompt|이전\s*지시.*무시|개인정보.*조회|SQL/i.test(normalized))
        throw new ServiceDenied();
    return normalized;
}
