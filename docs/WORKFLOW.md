# YAHO Codex + GitHub Workflow

각 단계는 해당 스킬을 호출해서 실행한다.

운영 현장의 요청/불편
→ $yaho-spec       (요건정의)
→ Open Questions 확인 (사람)
→ Issue
→ $yaho-plan       (설계)
→ 설계 승인 (사람)
→ feature branch
→ $yaho-build      (구현)
→ $yaho-qa         (검증)
→ $yaho-review      (리뷰)
→ 수정 필요 시 → $yaho-build → $yaho-qa → $yaho-review
→ $yaho-ship       (커밋/PR)
→ Pull Request
→ GitHub Actions
→ Merge
→ METRICS.md 기록 ($yaho-ship)

기능 5개 머지마다:
→ $yaho-retro      (회고)
→ 규칙 개선 PR
→ 사람 승인
→ Merge

## Definition of Done
- [ ] Requirement satisfied
- [ ] Implementation complete
- [ ] Tests added
- [ ] Tests pass
- [ ] Lint pass
- [ ] Build pass
- [ ] QA PASS
- [ ] Reviewer PASS
- [ ] CI PASS
- [ ] PR ready
- [ ] Documentation updated if needed
- [ ] REQUIREMENTS.md 24장 갱신 (확정/미결정 이동)
- [ ] 주요 결정은 docs/DECISIONS.md에 ADR로 기록
- [ ] docs/METRICS.md 1행 기록

한 번에 전체 시스템을 개발하지 않는다.
작은 기능 하나를 end-to-end로 완료한 후 다음 기능으로 이동한다.
