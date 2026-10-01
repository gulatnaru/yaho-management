import { Prisma } from "@prisma/client";

/**
 * 예약 신청 서버 코어가 던지는 에러. "use server" 파일은 async 함수만 export 할 수 있어
 * 별도 모듈로 둔다(lib/reservations/errors.ts 와 같은 패턴).
 */
export class ApplicationClosedError extends Error {}
export class ApplicationRateLimitedError extends Error {}
export class ApplicationNotFoundError extends Error {}
export class ApplicationNotPendingError extends Error {}
export class ApplicationDepositNotConfirmedError extends Error {}
export class ApplicationLinkNotFoundError extends Error {}
export class ApplicationLinkClassClosedError extends Error {}

/**
 * 로그용 오류 설명. Prisma 오류 메시지에는 입력값(이름·연락처 등)이 섞일 수 있어 message 를 기록하지 않는다.
 */
export function describeErrorForLog(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return `prisma:${error.code}`;
  if (error instanceof Error) return error.constructor.name || error.name || "Error";
  return "unknown";
}
