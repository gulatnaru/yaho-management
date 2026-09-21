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
→ Production schema gate (schema 변경 PR만 Environment 승인 후 migrate deploy)
→ Merge
→ Production release verification (schema 변경 release의 post-status + read-only smoke)
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
- [ ] `production-schema-gate` PASS
- [ ] schema 변경 release는 Production migration post-status와 invalid-login smoke PASS
- [ ] PR ready
- [ ] Documentation updated if needed
- [ ] REQUIREMENTS.md 24장 갱신 (확정/미결정 이동)
- [ ] 주요 결정은 docs/DECISIONS.md에 ADR로 기록
- [ ] docs/METRICS.md 1행 기록

한 번에 전체 시스템을 개발하지 않는다.
작은 기능 하나를 end-to-end로 완료한 후 다음 기능으로 이동한다.

## Schema-changing release

- `prisma/schema.prisma` 변경에는 신규 Prisma migration을 함께 제출한다. 기존 migration은 수정하거나 삭제하지 않는다.
- PR의 `production-schema-gate`를 최종 required check로 사용한다. schema 변경이 없으면 DB 접속 없이 성공하고, schema 변경이 있으면 GitHub `production` Environment 승인·preflight·`migrate deploy`·post-status가 모두 성공해야 한다.
- Environment 승인 전에 migration SQL과 exact PR head를 사람이 확인한다. Production secret과 함께 PR의 임의 script나 lifecycle script를 실행하지 않는다.
- main merge 후 schema-changing release는 현재 Production alias가 가리키는 exact Vercel deployment를 확인하고, read-only migration status와 invalid-login smoke 전후에 동일 deployment ID·SHA가 유지되는 것까지 성공해야 완료다.
- Production migration은 URL·tenant endpoint fingerprint와 연결 후 PostgreSQL database/role runtime fingerprint를 독립적으로 검증한다. pooler client username과 `current_user`가 같다고 가정하지 않는다.
- 실패한 migration을 자동 rollback하거나 Production에서 db push/reset/seed를 실행하지 않는다. 호환 가능한 app rollback 또는 검토된 forward migration으로 복구한다.
