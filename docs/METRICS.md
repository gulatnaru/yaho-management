# YAHO Development Metrics

Retrospective 에이전트의 입력이 되는 기록이다.
측정 기준이 없으면 "개선"은 취향 변경이 된다.

## 기록 주체
- Git Manager: PR 머지 시 해당 PR의 결과를 아래 표에 1행 추가한다.
- 사람이 수기로 채우지 않는다.

## 기록 항목

| PR | Issue | 기능 | CI 실패 횟수 | CRITICAL | MAJOR | QA 반려 횟수 | 재작업 횟수 | 주요 원인 |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

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
