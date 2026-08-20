---
description: 코드 품질과 보안을 검토한다
argument-hint: [검토 대상]
---

reviewer 서브에이전트를 사용해 코드 리뷰해줘.

대상: $ARGUMENTS

변경 내역: !`git diff main --stat`

Verdict 를 PASS 또는 CHANGES_REQUIRED 로 명확히 낼 것.
CRITICAL 이 있으면 PR 로 넘어가지 말 것.
