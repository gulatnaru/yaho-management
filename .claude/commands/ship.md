---
description: 커밋하고 PR을 올린다
argument-hint: [PR 제목]
disable-model-invocation: true
---

git-manager 서브에이전트를 사용해 마무리해줘.

PR 제목: $ARGUMENTS

현재 상태: !`git status --short`

순서:
1. secrets 나 .env 가 포함되지 않았는지 확인
2. lint / test / build 통과 확인
3. Conventional Commits 형식으로 커밋
4. PR 생성
5. docs/METRICS.md 에 이번 작업 1행 기록

QA 나 Reviewer 가 PASS 하지 않았으면 여기서 멈추고 알려줄 것.
main 에 직접 push 하지 말 것.
