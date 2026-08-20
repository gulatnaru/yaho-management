@AGENTS.md

## Claude Code 전용

역할은 `.claude/agents/` 의 서브에이전트로, 단계는 `.claude/commands/` 의 슬래시 커맨드로 실행한다.

`/spec` → `/plan` → `/build` → `/qa` → `/review` → (수정) → `/ship`
기능 5개 머지마다 `/retro`

Codex 의 `$yaho-*` 스킬과 같은 역할이며, 이름만 다르다.
AGENTS.md 의 Workflow 절에 적힌 `$yaho-spec` 등은 위 커맨드로 읽는다.

- 구현 전에 plan mode 또는 architect 로 설계를 먼저 확정한다.
- qa 와 reviewer 는 도구 수준에서 파일 수정이 막혀 있다. 수정은 developer 가 한다.
- 한 번에 한 기능만 진행한다.
