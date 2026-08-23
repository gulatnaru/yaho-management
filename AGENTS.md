# AGENTS.md — YAHO Development Rules

이 파일은 Codex 가 모든 작업 시작 시 자동으로 읽는다.
역할별 스킬은 `.agents/skills/` 에 있으며 `$스킬이름` 으로 호출한다.

## Project Goal
YAHO는 예약, 고객, 친구관계, 프로그램, 일정, 매출 및 운영을 관리하는 웹앱이다.

## Mandatory Technology Stack
- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Next.js Route Handlers / Server Actions
- PostgreSQL
- Supabase
- Prisma ORM
- Zod
- Auth.js
- Vitest
- Playwright
- GitHub Actions
- Vercel
- GitHub

## Architecture
기본 아키텍처는 Modular Monolith다.
처음부터 microservices로 분리하지 않는다.

## Domain Naming
Entity 명칭은 REQUIREMENTS.md v2를 따른다.
User / Child / Relationship / Teacher / Program / ClassSchedule / ClassTeacher / Reservation / Payment / Refund

Customer, Schedule, Friendship, ReservationParticipant는 사용하지 않는다.

## Source of Truth
1. 현재 사용자 요청
2. REQUIREMENTS.md
2-1. docs/DECISIONS.md
3. ARCHITECTURE.md
4. AGENTS.md
5. 기존 구현

## Coding Rules
- TypeScript strict mode를 사용한다.
- any 사용을 최소화한다.
- 서버에서 권한과 입력값을 검증한다.
- 외부 입력은 Zod로 검증한다.
- DB 접근은 Prisma를 사용한다.
- DB 변경은 Prisma migration으로 관리한다.
- 개인정보를 로그에 출력하지 않는다.
- secrets를 코드에 저장하지 않는다.
- Server/Client Component 경계를 명확히 한다.
- 비즈니스 로직을 UI에 과도하게 넣지 않는다.

## UI Rules
- shadcn/ui 우선
- Tailwind CSS 사용
- loading / empty / error 상태 구현
- 관리자 화면의 layout/navigation 일관성 유지
- 모바일 대응 고려

## Git Rules
- main 직접 개발 금지
- feature/<name>, hotfix/<name> 사용
- 작은 단위 commit
- Conventional Commits 권장
- force push 금지
- secrets/env 파일 commit 금지
- CI 실패 상태에서 merge 금지

## Workflow
$yaho-spec → $yaho-plan → $yaho-build → $yaho-qa → $yaho-review → (수정) → $yaho-ship

기능 5개 머지마다 $yaho-retro 로 규칙 개선안을 PR 로 제출한다.

## Role Rules
- 한 번에 하나의 역할만 수행한다. 역할을 섞지 않는다.
- $yaho-plan, $yaho-qa, $yaho-review 를 수행하는 동안에는 **파일을 수정하지 않는다.**
  문제를 발견하면 보고만 하고, 수정은 $yaho-build 로 역할을 바꾼 뒤에 한다.
- 설계 승인 없이 구현을 시작하지 않는다.
- 요건에 Open Questions 가 남아 있으면 구현을 시작하지 않는다.
- 한 번에 한 기능만 진행한다. 여러 Phase 를 동시에 열지 않는다.

## Decision Rules
- 금액, 환불 정책, 개인정보 수집 항목을 임의로 결정하지 않는다.
- 확정된 결정은 docs/DECISIONS.md 에 ADR 로 기록한다.
- $yaho-retro 의 제안은 자동 반영하지 않는다. 반드시 사람이 승인한다.

## Dangerous Commands
다음은 실행하지 않는다.
- git push --force
- main 브랜치 직접 push
- npx prisma migrate reset
- npx prisma db push
- .env 파일 내용 출력

## Decision Rules
- Analyst의 Open Questions가 남아 있으면 구현을 시작하지 않는다.
- 어떤 에이전트도 금액/환불 정책/개인정보 수집 항목을 임의로 결정하지 않는다.
- 확정된 결정은 docs/DECISIONS.md에 ADR로 기록한다.
- Retrospective의 제안은 자동 반영하지 않는다. 반드시 사람이 승인한다.

## Commands
개발 중 자주 쓰는 명령.

npm run lint
npm test
npm run build
npx prisma migrate dev
npx prisma studio

`npm run build` 는 `npm run dev` 와 `.next` 캐시를 공유한다. 역할과 무관하게(개발/QA/임시 진단 목적 포함)
`npm run build` 를 실행하기 전에는 `pgrep -f "next dev"` 등 포트에 의존하지 않는 방법으로 로컬 dev 서버가
떠 있는지 먼저 확인한다. 떠 있으면 build 를 생략하고 `npx tsc --noEmit` + lint + test 로 대체한 뒤 그 사실을
보고한다. 두 명령이 충돌하면 lint/test/build 는 모두 통과한 채로 실제 브라우저에서만 CSS 붕괴, 날짜 계산
오류 등으로 나타나 다른 버그로 오진하기 쉽다(docs/METRICS.md PR 5, Phase 4/PR 10, "공통" 행 — 동일 유형
3회 반복, 포트 3000 고정 점검 방식이던 이전 규칙(PR #9)으로는 다른 포트에서 뜬 dev 서버를 잡지 못했다).

## Completion Report
### Changed
### Tests
### Lint
### Build
### Risks
### Next
