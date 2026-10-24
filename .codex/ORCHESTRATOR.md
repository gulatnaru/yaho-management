# YAHO Multi-Agent Orchestrator — 운영 규칙

## 모델 정책 (2026-10-17)

| 역할 | 모델 | Reasoning | Sandbox | 코드 수정 |
|------|------|-----------|---------|-----------|
| Orchestrator | gpt-6.1-sol | xhigh | read-only | X |
| SPEC | gpt-6.1-sol | high | read-only | X |
| PLAN | gpt-6.1-sol | high | read-only | X |
| BUILD | gpt-6.1-sol | high | workspace-write | O (유일) |
| QA | gpt-6-luna | high | read-only | X |
| REVIEW | gpt-6.1-sol | high | read-only | X |
| SHIP | gpt-6-luna | medium | workspace-write | Git/CI만 |
| MEMORY | gpt-6-luna | low | workspace-write | Memory repo만 |

- 복잡한 QA·보안 검토는 QA를 GPT-6.1 Sol High로 승격 가능
- 중요한 아키텍처·보안 판단은 필요할 때만 Extra High 사용
- 동시 실행: 최대 3개 (`~/.codex/config.toml` → `[agents] max_concurrent_threads_per_session = 3`)

## 워크플로우

`$yaho-spec` → `$yaho-plan` → `$yaho-build` → `$yaho-qa` → `$yaho-review` → (결함 시 BUILD로 회귀) → `$yaho-ship`

- 한 번에 하나의 기능만 진행. 여러 Phase 동시 진행 금지
- SPEC·PLAN 승인 없이 구현 시작 금지. Open Questions 남아 있으면 시작 금지
- 결함 발견 시 BUILD → QA → REVIEW 자동 반복
- 기능 5개 머지마다 $yaho-retro (사람 승인 후 반영)

## 역할 분리

- Orchestrator는 업무 코드를 직접 수정하지 않는다
- BUILD developer Subagent만 승인된 업무 코드를 수정한다
- QA/REVIEW는 독립 검증만 하고 코드를 수정하지 않는다. 문제는 보고만
- SHIP은 승인된 Git·CI 작업만 수행한다

## 자동 승인 범위

승인된 개발 작업은 중간 승인 없이 이어서 진행한다.

## 사용자 승인 필수 항목

- 새로운 사업 정책이나 설계의 승인
- 실제 유료 API 호출
- 개인정보 처리·외부 전송
- Production DB Migration
- Production 배포
- PR Merge (PR #53·#54는 Draft 유지)
- 파괴적인 데이터 작업

## 절대 금지

- Production/Preview DB 접근·변경
- 실제 OpenAI/Kakao API 호출 (YAHO AI Service 용도)
- 고객 개인정보 처리
- 승인 없는 commit/push, force push, main 직접 push
- CI 실패 상태 merge
- `prisma migrate reset`, `prisma db push`
- secrets/.env 출력·커밋

## 체크포인트

- Phase 경계에서 yaho-memory subagent가 Agent Memory repo(`/home/hatch/agent-memory/yaho-management`)에 저장
- 작업 중단 후 재개 시: 실제 Git/CI 상태를 먼저 확인하고, 승인되지 않은 작업은 진행하지 않는다
