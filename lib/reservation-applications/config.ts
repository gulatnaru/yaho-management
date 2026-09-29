import { z } from "zod";

export type EnvironmentLike = Record<string, string | undefined>;

/**
 * 신청 완료 화면의 무통장 입금 안내와 YAHO 채널 링크(ADR-052).
 * 배포 설정(환경변수)으로 관리하며 관리자 설정 화면은 두지 않는다. 값을 바꾸면 재배포한다.
 */
export const PUBLIC_APPLICATION_ENV = {
  bankName: "RESERVATION_APPLICATION_BANK_NAME",
  bankAccountNumber: "RESERVATION_APPLICATION_BANK_ACCOUNT_NUMBER",
  bankAccountHolder: "RESERVATION_APPLICATION_BANK_ACCOUNT_HOLDER",
  blogUrl: "YAHO_BLOG_URL",
  instagramUrl: "YAHO_INSTAGRAM_URL",
  kakaoChannelUrl: "YAHO_KAKAO_CHANNEL_URL",
} as const;

const requiredValue = z.string().trim().min(1);
const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => value.startsWith("https://"));

const publicApplicationConfigSchema = z.object({
  bankName: requiredValue,
  bankAccountNumber: requiredValue,
  bankAccountHolder: requiredValue,
  blogUrl: httpsUrl,
  instagramUrl: httpsUrl,
  kakaoChannelUrl: httpsUrl,
});

export type PublicApplicationConfig = z.infer<typeof publicApplicationConfigSchema>;

/** 값이 하나라도 없거나 잘못되면 null 을 돌려준다. 호출자는 이 경우 접수를 닫는다(fail closed). */
export function readPublicApplicationConfig(env: EnvironmentLike = process.env): PublicApplicationConfig | null {
  const parsed = publicApplicationConfigSchema.safeParse({
    bankName: env[PUBLIC_APPLICATION_ENV.bankName],
    bankAccountNumber: env[PUBLIC_APPLICATION_ENV.bankAccountNumber],
    bankAccountHolder: env[PUBLIC_APPLICATION_ENV.bankAccountHolder],
    blogUrl: env[PUBLIC_APPLICATION_ENV.blogUrl],
    instagramUrl: env[PUBLIC_APPLICATION_ENV.instagramUrl],
    kakaoChannelUrl: env[PUBLIC_APPLICATION_ENV.kakaoChannelUrl],
  });
  return parsed.success ? parsed.data : null;
}
