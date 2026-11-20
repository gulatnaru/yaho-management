import { ServiceDenied } from "./contracts";

export function safeApprovedGuidanceText(content: string, topic: string): string {
    void topic;
    const text = content.normalize("NFKC").replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "").normalize("NFKC");
    if (!text.trim() || text.length > 1000 || /[<>]|https?:|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?82[- ]?)?0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/i.test(text) || /ignore.*instructions|system\s*prompt|이전\s*지시.*무시|개인정보.*조회|SQL/i.test(text)) throw new ServiceDenied();
    return text;
}
