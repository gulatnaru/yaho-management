## Summary

## Changes
-

## Tests
- [ ] Unit
- [ ] Integration
- [ ] E2E
- [ ] Manual

## Quality
- [ ] Lint
- [ ] Test
- [ ] Build

## Schema / Production release
- [ ] `prisma/schema.prisma` 또는 `prisma/migrations/**` 변경 없음
- [ ] schema 변경이 있다면 신규 migration만 추가했고 기존 migration을 수정·삭제하지 않음
- [ ] schema 변경이 있다면 migration SQL과 exact PR head를 검토함
- [ ] `production-schema-gate` 결과 확인
- [ ] Production에서 db push / migrate reset / seed를 사용하지 않음
- [ ] merge 후 schema-changing release의 post-status / invalid-login smoke 확인 예정

## Risks

## Related Issue
