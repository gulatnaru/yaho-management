import { z } from "zod";

export type KakaoShareFeed = {
  objectType: "feed";
  content: {
    title: string;
    description: string;
    link: { mobileWebUrl: string; webUrl: string };
  };
  buttons?: { title: string; link: { mobileWebUrl: string; webUrl: string } }[];
};

const feedInputSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  linkUrl: z.string().url().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch { return false; }
  }),
  buttonTitle: z.string().trim().min(1).optional(),
}).strict();

/**
 * Build data only; SDK loading and Kakao.Share invocation belong to phase 2.
 * Callers must supply non-PII copy and a public URL, never admin/customer data.
 * 100 title / 300 description Unicode characters are OUR client-side guardrails,
 * not Kakao's documented limits. At most one optional button is built here.
 */
export function buildReservationShareFeed(input: {
  title: string;
  description: string;
  linkUrl: string;
  buttonTitle?: string;
}): KakaoShareFeed {
  const parsed = feedInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid reservation share feed.");
  const { title, description, linkUrl, buttonTitle } = parsed.data;
  const link = { mobileWebUrl: linkUrl, webUrl: linkUrl };
  return {
    objectType: "feed",
    content: {
      title: Array.from(title).slice(0, 100).join(""),
      description: Array.from(description).slice(0, 300).join(""),
      link,
    },
    ...(buttonTitle ? { buttons: [{ title: buttonTitle, link: { ...link } }] } : {}),
  };
}

export function isKakaoShareConfigured(): boolean {
  // Kakao's JS key is public by design. NEVER put a REST API key, admin key or
  // secret in client code, or put any key value in env examples.
  // Presence alone does not verify the required Web platform domain registration.
  return Boolean(process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY?.trim());
}

function shareUrlForRoute(value: string, route: RegExp): string {
  const parsed = z.string().url().refine((candidate) => {
    try {
      const url = new URL(candidate);
      return route.test(url.pathname) && !url.search && !url.hash;
    } catch { return false; }
  }).safeParse(value);
  if (!parsed.success) throw new Error("Invalid share destination.");
  return parsed.data;
}

/** Only an ADMIN submission URL; customer routes and query/fragment data fail closed. */
export function buildAdminShareFeed(adminUrl: string): KakaoShareFeed {
  return buildReservationShareFeed({
    title: "YAHO 관리자 전용 예약 신청",
    description: "관리자 전용 링크입니다. 받는 사람도 관리자(ADMIN)로 로그인해야 합니다. 고객에게 보내지 마세요.",
    linkUrl: shareUrlForRoute(adminUrl, /^\/reservation-applications\/submissions\/[^/]+$/),
  });
}

/** Only a public application URL; admin routes and query/fragment data fail closed. */
export function buildCustomerShareFeed(applyUrl: string): KakaoShareFeed {
  return buildReservationShareFeed({
    title: "YAHO 예약 신청 안내",
    description: "이 링크에서 프로그램 예약을 신청해 주세요.",
    linkUrl: shareUrlForRoute(applyUrl, /^\/apply\/[^/]+$/),
  });
}
