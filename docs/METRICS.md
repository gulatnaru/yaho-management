# YAHO Development Metrics

Retrospective 에이전트의 입력이 되는 기록이다.
측정 기준이 없으면 "개선"은 취향 변경이 된다.

## 기록 주체
- Git Manager: PR 머지 시 해당 PR의 결과를 아래 표에 1행 추가한다.
- 사람이 수기로 채우지 않는다.

## 기록 항목

| PR | Issue | 기능 | CI 실패 횟수 | CRITICAL | MAJOR | QA 반려 횟수 | 재작업 횟수 | 주요 원인 |
|---|---|---|---|---|---|---|---|---|
| 1 | - | Phase 1 프로젝트 초기화 | 0 | 0 | 2 | 0 | 2 | OTHER |
| 4 | - | Phase 2 아이 관리 | 0 | 0 | 1 | 1 | 2 | REQUIREMENT |
| 5 | - | 모바일 우선 UI 적용 | 0 | 0 | 1 | 0 | 3 | TEST |
| 6 | - | Phase 3 프로그램/선생님 관리 | 0 | 0 | 0 | 0 | 1 | OTHER |
| 10 | - | Phase 4 클래스 일정 | 0 | 0 | 1 | 0 | 4 | TEST |
| - | - | (공통) 빌드 캐시 충돌로 인한 오진 — 3회째(PR 5 CSS 붕괴, Phase 4 날짜 넘침 오진 포함) | 0 | 0 | 0 | 0 | 1 | OTHER |
| 12 | - | Phase 5 예약 관리 | 0 | 0 | 2 | 0 | 1 | VALIDATION |
| - | - | (PR 12 비고) Phase 5 예약 관리 — 주요 원인은 ADR-029: `createReservationCore`가 표시상 종료(ENDED)된 클래스를 걸러내지 못한 공백. 화면(UI)에서는 종료된 클래스에 "예약 추가" 버튼을 숨겼지만 서버 액션이 이를 독립적으로 재검증하지 않아, 표시 계층에서만 막고 서버 검증이 빠졌던 케이스였다(개발 중 발견, 병합 전 f3a99c8에서 수정, cc3202d로 ADR 기록). 이번 Phase에서 Playwright E2E를 신규 도입(tests/e2e/class-ended-lifecycle.spec.ts)했고, 종료된 클래스 관련 6개 시나리오(예정 필터 제외, 완료 필터 조회, 상세 배지/버튼 노출, 신규 예약 서버 차단 등)가 로컬에서 전부 통과했다. REQUIREMENTS.md 23장에 "목록 필터/상태별 버튼 노출은 E2E로 검증"이 Definition of Done으로 명문화됨. | 0 | 0 | 0 | 0 | 0 | OTHER |
| 18 | - | Phase 8 결제/환불 관리 | 0 | 0 | 1 | 1 | 1 | TEST |
| 20 | - | Phase 9 매출 집계 | 0 | 0 | 0 | 0 | 1 | OTHER |
| 22 | - | Phase 10 관리자 홈/월간 예약 캘린더 | 0 | 0 | 0 | 1 | 2 | TEST |

## 원인 분류 코드
반복 유형을 세기 위해 아래 코드 중 하나로 적는다.

- VALIDATION: 입력 검증 누락
- AUTHZ: 권한 검증 누락
- INTEGRITY: 제약조건/중복/정원 위반
- REQUIREMENT: 요구사항 오해 또는 임의 결정
- BOUNDARY: Server/Client Component 경계 문제
- QUERY: N+1 등 Prisma 쿼리 문제
- TEST: 테스트 누락
- PRIVACY: 개인정보 노출
- OTHER

## 관찰 지표
Retrospective가 추이를 본다.

- CI 최초 통과율: 첫 push에서 CI가 통과한 PR 비율
- 재작업률: QA/Reviewer 반려로 다시 구현한 PR 비율
- CRITICAL 발생률: PR당 CRITICAL 건수
- 임의 결정 건수: Analyst의 Open Questions가 답변되지 않은 채 구현된 건수

## 해석 원칙
- 1회성 문제는 무시한다.
- 같은 원인 코드가 3회 이상 나오면 규칙 개선 대상이다.
- 지표가 나빠졌다고 규칙을 늘리기만 하지 않는다. 지켜지지 않는 규칙은 제거한다.
