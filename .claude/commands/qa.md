---
description: 구현된 기능을 요구사항 기준으로 검증한다
argument-hint: [검증 대상 기능]
---

qa 서브에이전트를 사용해 검증해줘.

대상: $ARGUMENTS

변경 내역: !`git diff main --stat`

REQUIREMENTS.md 의 Acceptance Criteria 를 기준으로 확인할 것.
서버에서만 막는 규칙과 민감 안전 정보 노출 여부를 반드시 포함할 것.
파일을 수정하지 말고 문제만 보고할 것.
