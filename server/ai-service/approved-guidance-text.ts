import { ServiceDenied } from "./contracts";

const nativeCardinals = ["", "하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "아홉"];
const nativeAdnominals = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"];
const nativeTens = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"];
const native = new Set<string>();
for (let number = 1; number <= 99; number++) {
    const tens = Math.floor(number / 10), ones = number % 10;
    native.add(nativeTens[tens] + nativeCardinals[ones]);
    native.add(ones === 0 && tens === 2 ? "스무" : nativeTens[tens] + nativeAdnominals[ones]);
}
for (const ones of nativeAdnominals.slice(1))
    native.add("스무" + ones);
const sinoOnes = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const sino = new Set<string>(["백", "천", "만", "억", "조"]);
for (let number = 1; number <= 99; number++) {
    const tens = Math.floor(number / 10), ones = number % 10;
    sino.add((tens ? (tens === 1 ? "" : sinoOnes[tens]) + "십" : "") + sinoOnes[ones]);
}
const ambiguousNative = new Set(["한", "두", "세", "네", "열", "쉰"]);
const unambiguousNumerals = new Set(["영", "공"]);
const approximateRoots = [...new Set([...native, ...sino, "서"])].sort((a, b) => b.length - a.length);
const approximateSuffixes = ["여", "댓", "넛", "어"];
const forms = [...new Set([...native, ...sino, "영", "공", "서너", "네댓", "예닐곱", "여남은", "한두", "두세", "대여섯", "일고여덟"])].sort((a, b) => b.length - a.length);
const particles = ["으로부터", "만으로", "이라고", "이라도", "에서는", "으로는", "까지는", "부터는", "만큼", "하고", "랑", "이랑", "쯤", "정도", "가량", "뿐", "씩", "이나", "라도", "에서", "께서", "께", "에게", "으로", "까지", "부터", "만", "은", "는", "이", "가", "을", "를", "도", "의", "와", "과", "에", "로", "나"];
const copulas = ["이었습니다", "였습니다", "입니다", "이에요", "예요", "이었다", "이다", "이고", "이며", "임"];
const suffix = new RegExp("^(?:(?:" + [...particles, ...copulas].join("|") + "))*$");
const explicitCopula = new RegExp("^(?:" + copulas.join("|") + ")(?:(?:" + particles.join("|") + "))*$");
const restrictiveSuffix = /^(?:만|뿐|씩|부터|까지|이라도|라도|입니다|이에요|예요|이다)/u;
const units = ["인분", "좌석", "자리", "가족", "가정", "가지", "개", "곳", "명", "인", "석", "팀", "건", "번", "회", "쌍", "배"];
const approximateNumeral = new RegExp("^(?:(?!이어)(?:" + approximateRoots.join("|") + ")(?:" + approximateSuffixes.join("|") + ")|이어(?!가지)(?:(?:" + [...units, "분", "살", "세"].join("|") + ").*|(?:(?:" + [...particles, ...copulas].join("|") + "))*)$)", "u");
const verbEndings = /^(?:시)?(?:았|었|ㅆ)?(?:다|고|면|서|세요|습니다|ㅂ니다|ㄴ|자|라|시|십시오|십시요|셨|지|나|게|요|니|네|는|라는)+$/u;
function verbContinuation(token: string) {
    const check1 = /^(?:두어|세어|열어|일어나|일어서)(?:봐|줘|둬)(.*)$/u.exec(token);
    if (check1) return !check1[1] || check1[1] === "야" || verbEndings.test(check1[1]);
    if (/^(?:(?:두어|세어|열어|일어나|일어서)(?:볼|둘|갈)|일어날)$/u.test(token)) return true;
    if (/^일어납니다$/u.test(token)) return true;
    const match = /^(?:(?:두어|세어|열어)(보|두|주|봤|줬|뒀|본)|일어(나|났|서|섰))(.*)$/u.exec(token);
    if (!match) return false;
    const stem = match[1] ?? match[2], tail = match[3];
    if (stem === "주" && /^(?:는|라는|라고|나)/u.test(tail)) return false;
    if (!tail) return ["봤", "줬", "뒀", "본", "났", "서", "섰"].includes(stem);
    return verbEndings.test(tail);
}
const compactCountClause = new RegExp("(?:" + [...native].sort((a, b) => b.length - a.length).join("|") + ")(?:(?:" + particles.join("|") + "))(?=(?:신청|예약|참가|참여|참석|가능|입장|수용))", "u");
const quantity = new RegExp("(" + forms.join("|") + ")(?:(?:" + particles.join("|") + "))?(" + units.join("|") + ")", "gu");
const clearStems = [...nativeCardinals.slice(5), ...nativeTens.slice(2).filter(word => word.length > 1), "스무"];
function containsQuantity(text: string) {
    quantity.lastIndex = 0;
    for (const match of text.matchAll(quantity)) {
        const tail = text.slice((match.index ?? 0) + match[0].length);
        if ((match[1] === "이" && match[2] === "곳") || (match[1] === "일" && match[2] === "자리") || ((match[1] === "이" && match[2] === "번") && tail.startsWith("주")))
            continue;
        if (match[2] === "번" && tail.startsWith("째"))
            continue;
        return true;
    }
    return false;
}
function remainingKoreanNumerals(text: string, compact: string, privateContext: boolean) {
    if (forms.includes(compact) || clearStems.some(stem => compact.includes(stem)) || containsQuantity(compact) || compactCountClause.test(compact))
        return true;
    const tokens = text.match(/\p{Script=Hangul}+/gu) ?? [];
    for (let start = 0; start < tokens.length; start++) {
        if ((approximateNumeral.test(tokens[start]) && !verbContinuation(tokens[start])) || ambiguousNative.has(tokens[start]))
            return true;
        let joined = "";
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
                if (explicitCopula.test(tail))
                    return true;
                if (native.has(form)) {
                    if (!ambiguousNative.has(form) || privateContext || restrictiveSuffix.test(tail))
                        return true;
                }
                else if (form.length > 1 || unambiguousNumerals.has(form) || privateContext)
                    return true;
            }
        }
    }
    return false;
}

const korean = ["영", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열", "열한", "열두", "열세", "열네", "열다섯", "열여섯", "열일곱", "열여덟", "열아홉"];
const numberPattern = "(?:\\d{1,2}|열아홉|열여덟|열일곱|열여섯|열다섯|열네|열세|열두|열한|다섯|여섯|일곱|여덟|아홉|열|한|두|세|네|영)";
const english = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "billion", "trillion"];
const separator = "[\\p{White_Space}\\p{Punctuation}\\p{Symbol}\\p{Mark}]*";
const englishNumbers = new RegExp("(?:^|[^a-z])(?:" + english.map(word => [...word].join(separator)).join("|") + ")(?=$|[^a-z])", "iu");
function numeric(value: string) {
    return /^\d+$/.test(value) ? Number(value) : korean.indexOf(value);
}
const capacitySuffixes = ["이상", "초과", "이하", "미만", "정도", "쯤"];
const capacityParticles = ["은", "는", "이", "가", "을", "를", "도", "의"];
const capacityCandidate = new RegExp("(?:(한\\s*반의\\s*아동\\s+))?(?:(기본)\\s*)?정원\\s*(?:은|는|이|가|의)?\\s*(?:(기본)\\s*)?(?<!\\p{N})8(?!\\p{N})\\s*명", "gu");
function capacityHasExcludedSuffix(sentence: string, end: number) {
    let rest = sentence.slice(end).replace(/^\s+/u, "");
    if (capacitySuffixes.some(word => rest.startsWith(word))) return true;
    const particle = capacityParticles.find(word => rest.startsWith(word));
    if (!particle) return false;
    rest = rest.slice(particle.length).replace(/^\s+/u, "");
    return capacitySuffixes.some(word => rest.startsWith(word));
}
function capacityHasContinuation(sentence: string, end: number) {
    const rest = sentence.slice(end).replace(/^\s+/u, "");
    return rest.length > 0 && (copulas.some(word => rest.startsWith(word)) || /^[.!?。,;:]/.test(rest));
}
function consumeCapacityCarveOut(text: string): string {
    return text.split(/(?<=[.!?。\n])/u).map(sentence => {
        const spans: Array<{ start: number; end: number }> = [];
        for (const match of sentence.matchAll(capacityCandidate)) {
            const start = match.index ?? 0;
            const end = start + match[0].length;
            if (match[2] && match[3]) continue;
            if (start > 0 && !/[\s\p{P}]/u.test(sentence[start - 1])) continue;
            if (capacityHasExcludedSuffix(sentence, end)) continue;
            if (!capacityHasContinuation(sentence, end)) continue;
            spans.push({ start, end });
        }
        if (spans.length === 0) return sentence;
        let blanked = sentence;
        for (let i = spans.length - 1; i >= 0; i--) blanked = blanked.slice(0, spans[i].start) + blanked.slice(spans[i].end);
        const blankedCompact = blanked.toLowerCase().replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}\p{Mark}]/gu, "");
        if (/\p{N}/u.test(blanked) || containsQuantity(blankedCompact) || remainingKoreanNumerals(blanked, blankedCompact, true)) return sentence;
        return blanked;
    }).join("");
}
export function safeApprovedGuidanceText(content: string, topic: string): string {
    void topic;
    const sourceNumbers = Array.from(content).filter(char => /\p{N}/u.test(char));
    if (sourceNumbers.some(char => !/\p{N}/u.test(char.normalize("NFKC")))) throw new ServiceDenied();
    const text = content.normalize("NFKC").replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "").normalize("NFKC");
    const consumed = consumeCapacityCarveOut(text);
    const compact = consumed.toLowerCase().replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}\p{Mark}]/gu, "");
    if (!text.trim() || text.length > 1000 || /[<>]|https?:|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?82[- ]?)?0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/i.test(text) || /ignore.*instructions|system\s*prompt|이전\s*지시.*무시|개인정보.*조회|SQL/i.test(text) || englishNumbers.test(text)) throw new ServiceDenied();
    if (/(?:정원|수용량|인원|신청자수|예약자수|참가자수|참여자수|예약건수|신청건수)\p{N}|(?:잔여|남은|빈)(?:자리|좌석|석|정원)|정원(?:현황|규모)|(?:인원|신청자수|예약자수|참가자수|참여자수|예약건수|신청건수|수용량)|\p{N}+(?:인|명|자리|좌석|석|건|人|席)|(?:참가|참여|참석|신청|예약|입장|수용)(?:할)?(?:(?:가능|예정|완료|확정|접수)(?:한|된)?|된|한|할|할수있는)?(?:수(?!(?:는|도|만)?(?:있|없))|건|명|인원|자리|좌석)/u.test(compact)) throw new ServiceDenied();
    let remaining = consumed.replace(/^(?:[1-9])\.(?=\s+\S)/gm, "");
    remaining = remaining.replace(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g, (match, y, m, d) => {
        const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
        return date.getUTCFullYear() === Number(y) && date.getUTCMonth() + 1 === Number(m) && date.getUTCDate() === Number(d) ? "" : match;
    });
    remaining = remaining.replace(/수업\s*시작\s*(\d{1,2})시간\s*전(?!후)/g, (match, h) => Number(h) >= 1 && Number(h) <= 24 ? "" : match);
    const age = new RegExp(`만\\s*(${numberPattern})\\s*(?:세|살)\\s*(?:부터(?:\\s*~)?|이상(?:\\s*(?:~|부터))?|~)\\s*(?:만\\s*)?(${numberPattern})\\s*(?:세|살)(?:까지)?`, "g");
    remaining = remaining.replace(age, (match, a, b) => numeric(a) >= 0 && numeric(b) >= 0 && numeric(a) <= 19 && numeric(b) <= 19 && numeric(a) <= numeric(b) ? "" : match);
    remaining = remaining.split(/(?<=[.!?。\n])/u).map(sentence => {
        if (!/마감|신청|접수/u.test(sentence)) return sentence;
        const time = new RegExp(`(?:(?:수업\\s*)?(?:전날|당일|수업일|\\d{1,2}일\\s*전)\\s*)?(오전|오후)?\\s*(${numberPattern})\\s*시(?:\\s*(\\d{1,2})분)?\\s*까지`, "g");
        return sentence.replace(time, (match, period, h, min) => {
            const hour = numeric(h), minute = Number(min ?? 0);
            return hour >= (period ? 1 : 0) && hour <= (period ? 12 : 23) && minute <= 59 ? "" : match;
        });
    }).join("");
    remaining = remaining.replace(/사회자만(?!\s*(?:이(?!(?:었습니다|입니다|에요|었다|다|고|며|임|십))|인분|좌석|자리|가족|가정|가지|개|곳|명|인|석|팀|건|번|회|쌍|배))|사회자|사회적/g, "");
    const standaloneAge = new RegExp(`(?:만\\s*)?(?:${forms.join("|")}|\\d{1,2})\\s*(?:세|살)`, "u");
    const headCount = new RegExp(`(${forms.join("|")})\\s*(분|명|인|자리|좌석|석|팀|반)`, "gu");
    function containsHeadCount(text: string) {
        headCount.lastIndex = 0;
        for (const match of text.matchAll(headCount)) {
            if (match[1] === "일" && match[2] === "자리" && !/\s/.test(match[0])) {
                const before = text.slice(0, match.index ?? 0).trimEnd().match(/\p{Script=Hangul}+$/u);
                if (!before || !forms.includes(before[0])) continue;
            }
            return true;
        }
        return false;
    }
    if (standaloneAge.test(remaining) || containsHeadCount(remaining) || remaining.split(/(?<=[.!?。\n])/u).some(sentence => /정원|수용량|인원|지도사|신청자|예약자|참가자|참여자|참석자/u.test(sentence) && remainingKoreanNumerals(sentence, sentence.toLowerCase().replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}\p{Mark}]/gu, ""), true))) throw new ServiceDenied();
    if (/\p{N}/u.test(remaining) || remainingKoreanNumerals(remaining, remaining.toLowerCase().replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}\p{Mark}]/gu, ""), false)) throw new ServiceDenied();
    return text;
}
