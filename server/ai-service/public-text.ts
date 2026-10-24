import { ServiceDenied } from "./contracts";
import { hasKoreanNumeral } from "./public-numerals";
export type PublicTextKind = "FREE" | "LOCATION";
// Bounded lexical guard, not a proof of arbitrary natural-language meaning.
// Short ambiguous Korean syllables (한/두/세/열...) are not rejected on their own.
const englishNumerals = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "billion", "trillion"];
const numeralSeparator = "[\\p{White_Space}\\p{Punctuation}\\p{Symbol}\\p{Mark}]*";
const canonicalEnglishNumerals = new RegExp("(?:^|[^a-z])(?:" + englishNumerals.map(word => [...word].join(numeralSeparator)).join("|") + ")(?=$|[^a-z])", "iu");
function scheduleNotice(text: string) {
    // Numeric free text is allowed only as this complete, validated schedule notice.
    const m = /^(?:(?:일정|수업일|집합|시작|종료)\s*:?\s*)?(?:(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일\s*)?(?:(오전|오후)?\s*(\d{1,2})시(?:\s*(\d{1,2})분)?)?(?:\s*(?:준비\s*안내|수업\s*안내|일정\s*안내|집합|시작|종료|예정입니다|입니다))?$/.exec(text.trim());
    if (!m || (!m[2] && !m[5]))
        return false;
    if (m[2]) {
        const year = Number(m[1] ?? 2000), month = Number(m[2]), day = Number(m[3]), date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day)
            return false;
    }
    if (m[5]) {
        const hour = Number(m[5]), minute = Number(m[6] ?? 0);
        if (minute > 59 || hour > (m[4] ? 12 : 23) || hour < (m[4] ? 1 : 0))
            return false;
    }
    return true;
}
function numericLocation(text: string) {
    const value = text.trim();
    // Only server-selected location fields may use these physical-address grammars.
    return /^[\p{L} ]{1,60}(?:숲|공원|수목원|센터|학교|관|역)\s*\d{1,4}번\s*(?:출구|입구|구역)$/u.test(value) ||
        /^(?:[\p{L} ]{1,40}동\s*)?\d{1,3}층(?:\s*\d{1,4}호)?$/u.test(value) ||
        /^[\p{L} ]{1,60}(?:로|길)\s*\d{1,4}(?:-\d{1,4})?$/u.test(value);
}
/** No numeric arbitrary free text. Trusted numeric fields and whole notices are separate projections. */
export function safePublicText(value: string, max = 1000, kind: PublicTextKind = "FREE") {
    // Preserve numeric provenance before NFKC can turn Roman/annotation numerals into letters.
    const sourceNumbers = Array.from(value).filter(char => /\p{N}/u.test(char));
    if (sourceNumbers.some(char => !/\p{N}/u.test(char.normalize("NFKC"))))
        throw new ServiceDenied();
    const normalized = value.normalize("NFKC").replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "").normalize("NFKC");
    const compact = normalized.toLowerCase().replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}\p{Mark}]/gu, "");
    // Raw capacity/seat quantity concepts never become public prose; availability is typed.
    const rawCapacity = /정원|좌석|잔여석|수용량|(?<!일)자리/u;
    if (rawCapacity.test(compact))
        throw new ServiceDenied();
    const countTopic = /정원|인원|예약자수|신청자수|참가자수|참여자수|예약건수|신청건수|예약수|잔여|남은자리|남은좌석|빈자리|빈좌석|좌석|자리수|만석|수용가능|capacity|headcount|classsize|remaining|seats?|vacanc|vacant|spots?|booked|bookings?|reservations?|registered|enroll|participants?|attendees?|people|persons?/i;
    // A private count topic is denied independently of digit, Roman or word notation.
    const countContext = /(?:참가|참여|참석|신청|예약|입장|수용)(?:할)?(?:(?:가능|예정|완료|확정|접수)(?:한|된)?|된|한|할|할수있는)?(?:수|건|명|인원|자리|좌석)/u;
    // Private occupancy concepts and actual participant populations remain private
    // irrespective of particles, units, spacing or the chosen numeral notation.
    const privateQuantity = /(?:수용|모집|참가|참여|참석|예약|신청|입장)(?:량|규모|총원|집계|현황)|(?:참가|참여|참석|신청|예약)(?:을|를|에)?(?:한|하신|하는|된|중인|확정된|완료한|하고있는)(?:가족|가정|팀|아이|어린이|보호자|고객)|occupancy|attendance|enrollment|quota/u;
    const quantityUnit = /\p{N}+(?:인|명|자리|좌석|석|건|人|席)/u;
    const privateNumeralContext = rawCapacity.test(compact) || countTopic.test(compact) || countContext.test(compact) || privateQuantity.test(compact) || /(?:신청|예약|참가|참여|참석)가능/u.test(compact);
    if (!normalized.trim() || normalized.length > max || countTopic.test(compact) || countContext.test(compact) || privateQuantity.test(compact) || quantityUnit.test(compact) || hasKoreanNumeral(normalized, compact, privateNumeralContext) || canonicalEnglishNumerals.test(normalized) ||
        /[<>]|https?:|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?82[- ]?)?0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/i.test(normalized) ||
        /ignore.*instructions|system\s*prompt|이전\s*지시.*무시|개인정보.*조회|SQL/i.test(normalized))
        throw new ServiceDenied();
    if ((sourceNumbers.length > 0 || /\p{N}/u.test(normalized)) && !(kind === "LOCATION" ? numericLocation(normalized) : scheduleNotice(normalized)))
        throw new ServiceDenied();
    return normalized;
}
