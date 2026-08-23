/**
 * createReservationCore 내부에서 "확인 후 쓰기" 사이의 레이스 컨디션을 막기 위해 던지는 내부 전용
 * 에러들이다. $transaction 콜백 안에서 throw 되면 전체 트랜잭션이 롤백되고, createReservation
 * (Server Action)의 catch 블록이 instanceof 로 구분해 사용자용 formError 메시지로 변환한다.
 * app/(admin)/classes/actions.ts 의 에러 클래스 패턴과 동일하다.
 *
 * "use server" 파일(app/(admin)/reservations/actions.ts)은 async 함수만 export 할 수 있어
 * 이 클래스들을 별도 모듈로 분리한다.
 */
export class ClassNotFoundError extends Error {}
export class ClassNotScheduledError extends Error {}
export class ChildNotFoundError extends Error {}
export class ChildNotActiveError extends Error {}
export class DuplicateReservationError extends Error {}
export class TerminalReservationError extends Error {}
export class CapacityFullError extends Error {}
