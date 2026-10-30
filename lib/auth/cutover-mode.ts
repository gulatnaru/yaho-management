/**
 * P2-S 전환 안전장치 — 계정 관리 권한의 모드 판정 (서버 전용).
 *
 * 설정: 환경변수 YAHO_ADMIN_CUTOVER_MODE 하나만 본다. NEXT_PUBLIC_ 접두사가
 * 없으므로 클라이언트 번들에 노출되지 않으며, 이 모듈은 서버 파일
 * (가드·코어·서버 컴포넌트)에서만 import해야 한다. 클라이언트 컴포넌트에서
 * import하면 빌드·검증 단계에서 차단 대상으로 본다.
 *
 * 값 (정확 일치만 인정, 대소문자·공백 변형은 무효):
 * - "LEGACY_ADMIN": 기존 ADMIN이 계정 관리를 수행한다 (P2 전환 전 상태).
 * - "SUPER_ADMIN": SUPER_ADMIN만 일반 계정 관리를 수행한다 (P2 전환 이후 계약).
 * - 그 외 전부 (미등록·빈 값·오타·소문자 포함): "INVALID"로 판정하고 계정
 *   관리 접근을 fail-closed로 거부한다. 기본값은 LEGACY가 아니다 —
 *   미등록 상태에서 조용히 LEGACY로 열리면 설정 누락이 전환 전 상태로
 *   위장되기 때문이다. 배포 전 설정 사전 점검이 필수 절차이다.
 *
 * 읽기 시점: 모듈 로드 시점이 아니라 호출 시점마다 process.env를 다시 읽는다.
 * 따라서 테스트의 환경변수 교체와 장수명 서버의 재시작이 즉시 반영되며,
 * 모드 판정을 캐시해 두는 경로는 존재하지 않는다. 단, Vercel에서는
 * 대시보드 환경변수 변경이 기존 배포에 적용되지 않고 새 배포에만 적용되므로
 * (공식 문서 기준), 운영 전환은 "환경변수 변경 + 재배포"로 수행하고
 * 재배포 자체를 별도 승인 지점으로 둔다. 코드가 스스로 모드를 바꾸는
 * 로직(자동 전환·자동 복귀)은 이 모듈은 물론 코드 어디에도 없다.
 * 전환 후 LEGACY 복귀는 별도 복구 승인 하에 사람이 환경변수를 바꾸고
 * 재배포하는 절차적 통제로만 수행한다.
 *
 * 판정 사용처 (모두 동일한 이 함수를 쓴다 — 계층별 판정 분기 금지):
 * - lib/auth/authorization.ts requireAccountManagementPrincipal()
 *   (계정 액션·쿼리·페이지 가드)
 * - server/accounts/mutations.ts assertAccountManagementActor()
 *   (트랜잭션 내 행위자 재검증 — 가드와 별개로 모드를 다시 읽는다)
 * - app/(admin)/layout.tsx 계정 관리 메뉴 노출 (표시일 뿐, 경계가 아니다)
 *
 * 본인 이력 전용 경로(listOwnAccountHistory, OQ-12)는 계정 관리가 아니라
 * 읽기 전용 본인 조회이므로 모드와 무관하게 P2 계약을 유지한다
 * (SUPER_ADMIN·ADMIN·STAFF 본인-only, 그 외 거부).
 */
export const ACCOUNT_CUTOVER_MODE_ENV = "YAHO_ADMIN_CUTOVER_MODE";

export type AccountCutoverMode = "LEGACY_ADMIN" | "SUPER_ADMIN" | "INVALID";

export function resolveAccountCutoverMode(env: NodeJS.ProcessEnv = process.env): AccountCutoverMode {
  const raw = env[ACCOUNT_CUTOVER_MODE_ENV];
  if (raw === "LEGACY_ADMIN") return "LEGACY_ADMIN";
  if (raw === "SUPER_ADMIN") return "SUPER_ADMIN";
  return "INVALID";
}
