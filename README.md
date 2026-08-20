# YAHO Management System
## Codex Development Environment

AI-native 운영관리 웹앱 개발환경. Codex 기준.

- `AGENTS.md` — Codex 가 작업 시작 시 자동으로 읽는 개발 규칙
- `.agents/skills/` — 역할별 스킬 7종. `$이름` 으로 호출
- `REQUIREMENTS.md` — 요구사항 (Source of Truth)
- `docs/DECISIONS.md` — 결정 기록(ADR)
- `docs/METRICS.md` — 회고 입력용 개발 지표

### Skills
| 호출 | 역할 |
|---|---|
| `$yaho-spec` | 요건정의 |
| `$yaho-plan` | 설계 |
| `$yaho-build` | 구현 |
| `$yaho-qa` | 검증 |
| `$yaho-review` | 코드 리뷰 |
| `$yaho-ship` | 커밋 / PR |
| `$yaho-retro` | 회고 및 규칙 개선 |

스킬이 `/skills` 목록에 안 보이면 Codex 를 재시작한다.

상세 업무 요구사항은 `REQUIREMENTS.md` v2에 정의되어 있으며, 현재 확정된 핵심 운영 규칙과 향후 결정이 필요한 항목을 구분한다.

### Tech Stack
- Next.js (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- PostgreSQL
- Supabase (managed PostgreSQL)
- Prisma ORM
- Zod
- Auth.js
- Vitest
- Playwright
- GitHub Actions
- Vercel
- Codex

### Agent Team
- Analyst: 요건정의 (REQUIREMENTS.md 소유)
- Architect: 아키텍처/설계
- Developer: 구현
- QA: 테스트
- Reviewer: 코드 리뷰
- Git Manager: Git/PR/Release
- Retrospective: 프로세스/규칙 개선 (사람 승인 필수)

### Workflow
`$yaho-spec` → `$yaho-plan` → `$yaho-build` → `$yaho-qa` → `$yaho-review` → (수정) → `$yaho-ship`

기능 5개 머지마다 `$yaho-retro`

### Domain Naming
User / Child / Relationship / Teacher / Program / ClassSchedule / ClassTeacher / Reservation / Payment / Refund

### Development Principle
처음에는 Modular Monolith로 구축한다.
서비스를 무리하게 분리하지 않는다.
기능 단위로 작게 개발하고 끝까지 검증한 뒤 다음 기능으로 이동한다.
