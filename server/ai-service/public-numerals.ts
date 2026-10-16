/**
 * Bounded Korean quantity grammar: native cardinal/adnominal forms 1..99,
 * plus Sino forms when their token or quantity context is unambiguous.
 * This is a lexical safeguard, not general natural-language understanding.
 */
const nativeCardinals = ["", "하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "아홉"];
const nativeAdnominals = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"];
const nativeTens = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"];
const native = new Set<string>();
for (let number = 1; number <= 99; number++) {
    const tens = Math.floor(number / 10), ones = number % 10;
    native.add(nativeTens[tens] + nativeCardinals[ones]);
    native.add(ones === 0 && tens === 2 ? "스무" : nativeTens[tens] + nativeAdnominals[ones]);
}
// Also reject nonstandard spacing/inflection of the recognised twenty stem.
for (const ones of nativeAdnominals.slice(1))
    native.add("스무" + ones);
const sinoOnes = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const sino = new Set<string>(["백", "천", "만", "억", "조"]);
for (let number = 1; number <= 99; number++) {
    const tens = Math.floor(number / 10), ones = number % 10;
    sino.add((tens ? (tens === 1 ? "" : sinoOnes[tens]) + "십" : "") + sinoOnes[ones]);
}
const ambiguousNative = new Set(["한", "두", "세", "네", "열", "쉰"]);
const forms = [...new Set([...native, ...sino])].sort((a, b) => b.length - a.length);
const particles = ["으로부터", "만으로", "이라고", "이라도", "에서는", "으로는", "까지는", "부터는", "만큼", "뿐", "씩", "이나", "라도", "에서", "에게", "으로", "까지", "부터", "만", "은", "는", "이", "가", "을", "를", "도", "의", "와", "과", "에", "로", "나"];
const copulas = ["이었습니다", "였습니다", "입니다", "이에요", "예요", "이었다", "이다", "이고", "이며", "임"];
const suffix = new RegExp("^(?:(?:" + [...particles, ...copulas].join("|") + "))*$");
const explicitCopula = new RegExp("^(?:" + copulas.join("|") + ")(?:(?:" + particles.join("|") + "))*$");
const restrictiveSuffix = /^(?:만|뿐|씩|부터|까지|이라도|라도|입니다|이에요|예요|이다)/u;
const units = ["인분", "좌석", "자리", "가족", "가정", "가지", "개", "곳", "명", "인", "석", "팀", "건", "번", "회", "쌍", "배"];
const compactCountClause = new RegExp("(?:" + [...native].sort((a, b) => b.length - a.length).join("|") + ")(?:(?:" + particles.join("|") + "))(?=(?:신청|예약|참가|참여|참석|가능|입장|수용))", "u");
const quantity = new RegExp("(" + forms.join("|") + ")(?:(?:" + particles.join("|") + "))?(" + units.join("|") + ")(?=$|(?:" + [...particles, ...copulas].join("|") + "))", "gu");
// These complete multi-syllable stems have no normal short-syllable reading;
// deriving them from the grammar avoids selecting only some example numbers.
const clearStems = [...nativeCardinals.slice(5), ...nativeTens.slice(2).filter(word => word.length > 1), "스무"];
function containsQuantity(text: string) {
    quantity.lastIndex = 0;
    for (const match of text.matchAll(quantity)) {
        // Normal deictic 이곳 and employment 일자리 are not Sino quantities.
        if ((match[1] === "이" && match[2] === "곳") || (match[1] === "일" && match[2] === "자리"))
            continue;
        return true;
    }
    return false;
}
export function hasKoreanNumeral(text: string, compact: string, privateContext: boolean) {
    if (forms.includes(compact) || clearStems.some(stem => compact.includes(stem)) || containsQuantity(compact) || compactCountClause.test(compact))
        return true;
    const tokens = text.match(/\p{Script=Hangul}+/gu) ?? [];
    for (let start = 0; start < tokens.length; start++) {
        let joined = "";
        // A finite token window permits character spaces and split units/particles.
        for (let end = start; end < Math.min(tokens.length, start + 12); end++) {
            joined += tokens[end];
            if (joined.length > 32)
                break;
            if (containsQuantity(joined))
                return true;
            for (const form of forms) {
                if (!joined.startsWith(form))
                    continue;
                const tail = joined.slice(form.length);
                if (!suffix.test(tail))
                    continue;
                // A recognised numeral plus an explicit copula is a numeric assertion,
                // even when its short Sino form is ambiguous as an ordinary standalone word.
                if (explicitCopula.test(tail))
                    return true;
                if (native.has(form)) {
                    if (!ambiguousNative.has(form) || privateContext || restrictiveSuffix.test(tail))
                        return true;
                }
                else if (form.length > 1 || privateContext)
                    return true;
            }
        }
    }
    return false;
}
