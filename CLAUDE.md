@AGENTS.md

## Source of Truth 보충

AGENTS.md 의 Source of Truth 목록(REQUIREMENTS.md / docs/DECISIONS.md / ARCHITECTURE.md / AGENTS.md / 기존 구현)에
`docs/UI-GUIDELINES.md` 를 추가한다. UI 관련 사항(브레이크포인트, 네비게이션, 목록 열 상한, 검색/필터 접힘, 연락처 표시 등)은
REQUIREMENTS.md 와 함께 docs/UI-GUIDELINES.md 를 따른다.

## Claude Code 전용

역할은 `.claude/agents/` 의 서브에이전트로, 단계는 `.claude/commands/` 의 슬래시 커맨드로 실행한다.

`/spec` → `/plan` → `/build` → `/qa` → `/review` → (수정) → `/ship`
기능 5개 머지마다 `/retro`

Codex 의 `$yaho-*` 스킬과 같은 역할이며, 이름만 다르다.
AGENTS.md 의 Workflow 절에 적힌 `$yaho-spec` 등은 위 커맨드로 읽는다.

- 구현 전에 plan mode 또는 architect 로 설계를 먼저 확정한다.
- qa 와 reviewer 는 도구 수준에서 파일 수정이 막혀 있다. 수정은 developer 가 한다.
- 한 번에 한 기능만 진행한다.

## Language
사용자와의 모든 대화는 한국어로 한다.
설명, 질문, 완료 보고, 커밋 메시지 본문 모두 한국어를 사용한다.
코드, 변수명, 파일명, Conventional Commits 접두어(feat, fix 등)는 영어를 유지한다.