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

export function classifyInfrastructureError(error: unknown): string | null {
  const code = error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code
    : error instanceof Prisma.PrismaClientInitializationError
      ? error.errorCode
      : undefined;

  switch (code) {
    case "P2028":
      return "예약 확정 처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.";
    case "P2024":
      return "데이터베이스 연결 대기 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.";
    case "P1001":
      return "데이터베이스 연결에 실패했습니다. 잠시 후 다시 시도해주세요.";
    default:
      return null;
  }
}

/**
 * 로그용 오류 설명. Prisma 오류 메시지에는 입력값(이름·연락처 등)이 섞일 수 있어 message 를 기록하지 않는다.
 */
export function describeErrorForLog(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return `prisma:${error.code}`;
  if (error instanceof Prisma.PrismaClientInitializationError && error.errorCode) return `prisma:${error.errorCode}`;
  if (error instanceof Error) return error.constructor.name || error.name || "Error";
  return "unknown";
}
