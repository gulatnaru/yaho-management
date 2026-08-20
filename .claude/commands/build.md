---
description: 설계에 따라 구현한다
argument-hint: [구현할 단계]
---

developer 서브에이전트를 사용해 다음을 구현해줘.

대상: $ARGUMENTS

현재 브랜치: !`git branch --show-current`

main 브랜치라면 먼저 feature 브랜치를 만들 것.
요청 범위 밖의 리팩터링은 하지 말 것.
서버에서만 검증하는 규칙(정원 8명, 중복 예약, 환불 한도, 선생님 2명)에는 반드시 테스트를 붙일 것.
환불은 트랜잭션으로, ChildConsent 는 append-only 로 처리할 것.
끝나면 lint / test / build 를 실행하고 결과를 보고할 것.
