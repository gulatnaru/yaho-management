---
name: yaho-orchestrate
description: YAHO 기능 요청을 SPEC부터 SHIP까지 역할별 subagent로 조정하고 QA·Review 재작업과 release gate를 관리한다. 전체 YAHO 개발 workflow를 한 번에 끝까지 실행할 때 사용한다.
---

# YAHO Orchestrator

## 역할

YAHO 개발 workflow의 root orchestrator다. 다음 상태를 관리하고 각 단계는 해당 역할의 기존 skill을 읽은 별도 subagent에게 위임한다.

`SPEC -> PLAN -> BUILD -> QA -> REVIEW -> SHIP`

root는 구현자가 아니다. 직접 production code, test, schema, workflow 또는 문서를 작성하지 않는다. 단계 전환, 권한 통제, 결과 검증, finding 추적, 재작업 routing 및 최종 gate 확인만 담당한다.

시작할 때 다음을 모두 읽고 계약의 source of truth로 사용한다.

- `AGENTS.md`
- `.agents/skills/yaho-spec/SKILL.md`
- `.agents/skills/yaho-plan/SKILL.md`
- `.agents/skills/yaho-build/SKILL.md`
- `.agents/skills/yaho-qa/SKILL.md`
- `.agents/skills/yaho-review/SKILL.md`
- `.agents/skills/yaho-ship/SKILL.md`

이 skill은 기존 역할 계약을 대체하거나 완화하지 않는다. source of truth 우선순위는 `AGENTS.md`를 그대로 따르고, 역할별 수행 계약은 기존 role skill을 따른다.

## 실행 구성

root session의 요구 구성은 다음과 같다.

- model: `gpt-5.6-sol`
- reasoning: `ultra`

단계별 subagent는 다음 구성을 사용한다.

| 단계 | Model | Reasoning | 권한 |
| --- | --- | --- | --- |
| SPEC | `gpt-5.6-sol` | `high` | 기존 `$yaho-spec` 계약 |
| PLAN | `gpt-5.6-sol` | `high` | read-only |
| BUILD / BUILD_FIX | `gpt-5.6-terra` | `high` | 승인 범위 write, commit/push/PR 금지 |
| QA / RE_QA | `gpt-5.6-terra` | `high` | independent, read-only |
| REVIEW / RE_REVIEW | `gpt-5.6-sol` | `xhigh` | independent, read-only |
| SHIP | `gpt-5.6-terra` | `high` | 기존 `$yaho-ship` 계약 |

정확한 model 또는 reasoning 설정을 플랫폼이 지원하지 않으면 조용히 다른 설정으로 대체하거나 root가 역할을 대신하지 않는다. 사용할 수 있는 delegation 기능과 설정을 확인하고, 충족할 수 없으면 외부 실행 역량 blocker로 보고한다.

optional research/documentation agent는 현재 orchestrator의 고정 agent topology에 포함하지 않는다. 필요한 repository/document 조사는 SPEC 또는 PLAN agent가 자신의 read-only 또는 문서 소유권 범위 안에서 처리한다. 현재 runtime에 없는 Luna agent나 다른 model fallback을 가정하지 않는다. 향후 supported spawn model 목록에 Luna가 포함된 것이 확인되면 별도 변경으로 추가한다.

사용자가 별도 Codex task 생성을 요청하지 않은 한 사용자 소유 task/thread를 만들지 않는다. 현재 작업에 종속된 subagent delegation 기능을 사용한다.

## 시작 전 점검

1. 기능 목표와 완료 조건을 확인한다. 목표 자체가 없거나 제품 결정을 먼저 받아야 하면 `STOP_USER_DECISION`으로 멈춘다.
2. 현재 branch, HEAD, tracked/staged/untracked 상태, upstream 및 protected untracked를 확인한다.
3. 기본 protected untracked는 다음과 같고 사용자가 추가한 경로도 함께 보존한다.
   - `.agents/skills/source-command-retro/`
   - `.codex/`
   - `paseo.json`
4. 사용자 작업을 `reset`, `checkout --`, `clean`, 임의 `stash`로 없애지 않는다.
5. 관련 없는 tracked/staged 변경 또는 다른 작업의 branch가 있으면 덮어쓰지 말고 blocker로 보고한다.
6. `main`에서 시작하고 working tree가 안전하면 writer 단계 전에 목표에 맞는 `feature/<slug>` 또는 `hotfix/<slug>` branch를 만든다. `main`에서 직접 개발하지 않는다.
7. SHIP 전에는 stage, commit, push, PR을 만들지 않는다.

## 상태 원장

root는 다음 상태를 구조적으로 유지한다.

- feature goal과 명시적 사용자 제약
- base branch/SHA, 작업 branch/SHA, protected paths
- 현재 단계와 완료된 단계
- accepted SPEC, Open Questions, 관련 ADR과 source files
- approved PLAN과 계획 밖 변경 금지 영역
- schema/migration 변경 여부
- 검증 명령과 결과
- QA/Review verdict
- finding별 stable ID, severity, 근거, 상태, 발생/재발 횟수
- `agent_attempt_count`
- `qa_rework_count`
- `review_rework_count`
- `total_rework_count`
- `identical_finding_streak`
- `ci_implementation_rework_count`
- `transient_operation_attempt_count`
- QA rejection count
- CRITICAL count
- MAJOR count
- rework count
- GitHub CI failure count
- primary cause
- Production approval/credential 상태

agent 요약만 신뢰하지 말고 단계 전환 전에 repository 상태, diff, verdict 및 핵심 근거를 root가 확인한다. finding ID는 단계, 영향 경계 또는 파일, root cause를 기준으로 안정적으로 유지하여 같은 문제가 표현만 달라져 중복 집계되지 않게 한다.

## 유한 실행 한도와 counter

모든 자동 retry와 rework는 다음 상한을 적용한다.

- `MAX_AGENT_ATTEMPTS = 3`: 한 agent invocation의 initial attempt 1회와 retry 최대 2회
- `MAX_QA_REWORK = 3`: QA finding으로 실행하는 BUILD_FIX 최대 3회
- `MAX_REVIEW_REWORK = 3`: Review finding으로 실행하는 BUILD_FIX 최대 3회
- `MAX_TOTAL_REWORK = 6`: QA/Review finding으로 실행하는 BUILD_FIX 합계 최대 6회
- `MAX_IDENTICAL_FINDING_STREAK = 3`: 같은 finding의 연속 등장 최대 2회까지 자동 수정하고 3번째 등장 시 차단
- `MAX_CI_IMPLEMENTATION_REWORK = 3`: SHIP CI의 구현 결함으로 실행하는 BUILD_FIX 최대 3회
- `MAX_TRANSIENT_OPERATION_ATTEMPTS = 3`: CI 또는 외부 service의 동일 transient operation initial attempt 1회와 retry 최대 2회

counter 의미는 다음과 같다.

- `agent_attempt_count`: 현재 agent invocation의 실행 횟수다. 새 invocation을 시작할 때 0으로 reset하고 매 attempt 전에 증가한다.
- `qa_rework_count`: 유효한 QA `CHANGES_REQUIRED`로 BUILD_FIX를 시작한 횟수다.
- `review_rework_count`: 유효한 Review `CHANGES_REQUIRED`로 BUILD_FIX를 시작한 횟수다.
- `total_rework_count`: `qa_rework_count + review_rework_count`다. 초기 BUILD와 CI retry는 포함하지 않는다.
- `identical_finding_streak`: stable ID, 관련 파일/경계, severity와 root cause가 같은 finding이 같은 검증 역할의 연속 유효 verdict에 등장한 횟수다. QA finding은 QA/RE_QA stream에서, Review finding은 REVIEW/RE_REVIEW stream에서 각각 계산한다. Review 사이의 필수 RE_QA처럼 다른 역할의 중간 verdict는 streak를 reset하지 않는다. 같은 역할의 다음 verdict에서 finding이 사라지면 reset한다.
- `ci_implementation_rework_count`: 실제 GitHub CI의 현재 구현 결함 때문에 BUILD_FIX를 시작한 횟수다. QA/Review control counter와 별도로 기록한다.
- `transient_operation_attempt_count`: code change 없는 동일 CI/external operation 재시도 횟수다. implementation rework와 구분한다.

상한에 도달한 상태에서 다음 retry 또는 BUILD_FIX가 필요하거나, 같은 finding이 세 번째 연속 등장하면 추가 agent를 spawn하지 않고 `BLOCKED`로 전환한다. unlisted automatic retry path는 허용하지 않는다. 새 retry path에는 실행 전에 반드시 유한한 상한과 counter를 정의한다.

### Agent invocation failure

agent crash, tool/runtime failure, malformed output, required verdict 누락 또는 해당 role의 필수 output contract 누락은 implementation finding으로 해석하지 않는다. 같은 role과 권한으로 최대 세 번만 시도한다.

1. attempt 1 실패: `agent_attempt_count = 1`, retry
2. attempt 2 실패: `agent_attempt_count = 2`, 마지막 retry
3. attempt 3 실패: `agent_attempt_count = 3`, `BLOCKED`

QA의 `PASS/CHANGES_REQUIRED`, Review의 `Verdict`, 또는 다른 stage의 필수 구조가 없는 output은 유효한 stage 결과가 아니므로 QA rejection, finding 또는 rework count를 증가시키지 않는다.

### BLOCKED

`BLOCKED`는 제품/정책/승인을 기다리는 `USER_DECISION`과 다른 기술적 종료 상태다. `BLOCKED`가 되면 다음을 수행한다.

- 자동 subagent spawn, 자동 retry와 자동 수정 중단
- stage, commit, push, PR과 merge 금지
- current git state와 protected paths 보존
- unresolved findings와 모든 counter 보존
- 마지막 성공 단계와 실패 단계 기록
- 사용자에게 blocker와 안전한 다음 action 보고

BLOCKED 보고에는 반드시 다음을 포함한다.

- `blocked_stage`
- `reason`
- `agent_attempt_count`
- `qa_rework_count`
- `review_rework_count`
- `total_rework_count`
- repeated finding 여부와 해당 stable ID
- repeated finding이면 관련 파일/경계, severity, 이전 fix attempts와 test 결과
- unresolved findings
- current git state
- recommended next action

## Context 전달

각 subagent에는 역할 수행에 필요한 최소 context만 전달한다.

- feature goal
- 현재 단계와 호출할 기존 skill
- accepted SPEC
- relevant ADRs와 파일
- approved PLAN 중 해당 단계 범위
- 직전 단계 결과
- 현재 git state
- protected untracked 목록
- unresolved findings와 허용된 수정 범위
- 해당 역할의 write/외부 변경 권한

부모 대화 전체를 무분별하게 복사하지 않는다. 모든 subagent에게 자신의 기존 `SKILL.md`를 처음부터 끝까지 읽고 그 계약을 따르라고 명시한다.

PLAN, QA와 REVIEW agent에는 read-only 권한을 준다. 플랫폼이 read-only sandbox를 제공하면 사용하고, root는 실행 전후 git 상태와 diff를 비교한다. read-only agent가 파일을 변경하면 자동으로 되돌리지 말고 unauthorized mutation blocker로 보고한다.

BUILD와 BUILD_FIX는 같은 승인 범위의 writer다. QA와 REVIEW는 builder와 분리된 fresh, independent agent를 사용하고 서로의 결론을 그대로 복제하지 않는다.

## 상태 전이

정상 경로와 예외 상태는 다음과 같다.

- 정상: `SPEC -> PLAN -> BUILD -> QA -> REVIEW -> SHIP -> DONE`
- 사용자 결정: `ANY STAGE -> USER_DECISION`
- 기술 blocker 또는 limit 도달: `ANY AUTOMATED STAGE -> BLOCKED`
- QA 재작업: `QA CHANGES_REQUIRED -> counter check -> BUILD_FIX -> RE_QA`
- Review 재작업: `REVIEW CHANGES_REQUIRED -> counter check -> BUILD_FIX -> RE_QA -> RE_REVIEW`

어떤 retry/rework limit도 우회하지 않으며 limit 도달 후에는 다음 자동 단계를 시작하지 않는다.

### 1. SPEC

SPEC agent가 기존 `$yaho-spec` 계약을 실행한다.

- 요구사항, 현재 문제, business rules, acceptance criteria, conflicts 및 Open Questions를 조사한다.
- 제품/운영/정책 결정을 추측하지 않는다.
- Open Questions가 1개 이상이면 문서 계약에 맞게 멈추고 root는 `STOP_USER_DECISION`을 반환한다.
- Open Questions가 0이고 SPEC 산출물과 필요한 ADR이 일관되면 `PLAN`으로 진행한다.

사용자 답변을 받으면 완료된 조사를 반복하지 않고 답변을 SPEC state에 반영한 뒤 필요한 SPEC 확인부터 재개한다.

### 2. PLAN

PLAN agent가 기존 `$yaho-plan` 계약을 read-only로 실행한다.

`$yaho-orchestrate` 호출은 accepted SPEC과 ADR을 충실히 구현하는 PLAN에 한하여 다음 단계로 진행하라는 사전 승인으로 간주한다. 따라서 다음 조건을 모두 만족하면 별도 승인 질문 없이 BUILD로 진행한다.

- PLAN이 accepted SPEC의 모든 acceptance criteria를 mapping한다.
- 새로운 제품/운영 결정을 만들지 않는다.
- 기존 ADR과 충돌하지 않는다.
- 범위, 위험 또는 외부 변경 권한을 확대하지 않는다.

PLAN이 새 선택, 요구사항 충돌, 파괴적 조치 또는 범위 확장을 요구하면 사전 승인을 적용하지 않고 사용자에게 멈춘다.

### 3. BUILD

BUILD agent가 기존 `$yaho-build` 계약으로 approved SPEC/PLAN만 구현한다.

- 승인된 code/test/docs/schema 범위만 수정한다.
- protected untracked와 사용자 변경을 보존한다.
- PLAN에 없는 리팩터링이나 정책 변경을 추가하지 않는다.
- 필요한 targeted/full 검증을 수행한다.
- commit, push, PR 및 Production 변경을 하지 않는다.

완료 후 root가 diff scope, schema/migration 상태, staged 상태, 보호 경로 및 검증 결과를 확인하고 QA로 전환한다.

### 4. QA

fresh QA agent가 기존 `$yaho-qa` 계약으로 independent, read-only 검증을 수행한다.

- `PASS`: finding 원장을 갱신하고 REVIEW로 진행한다.
- `CHANGES_REQUIRED`: 모든 finding을 누락 없이 stable ID와 severity로 기록하고 QA rejection count를 증가시킨다. 먼저 identical finding streak와 QA/global rework limit을 확인한다. 세 번째 동일 finding이거나 `qa_rework_count >= 3` 또는 `total_rework_count >= 6`이면 `BLOCKED`로 전환한다. 그 외에는 두 rework counter를 각각 1 증가시키고 좁은 BUILD_FIX task로 전달한다.

QA 재작업 흐름은 반드시 다음과 같다.

`QA CHANGES_REQUIRED -> BUILD_FIX -> RE_QA`

RE_QA가 PASS할 때까지 위 상한 안에서만 반복한다. 상한에 도달하면 `BLOCKED`로 전환한다.

### 5. REVIEW

QA PASS 후 fresh REVIEW agent가 기존 `$yaho-review` 계약으로 independent, read-only review를 수행한다.

- `PASS`: unresolved CRITICAL/MAJOR가 0인지 확인하고 SHIP으로 진행한다.
- `CHANGES_REQUIRED`: 모든 finding을 기록하고 identical finding streak와 Review/global rework limit을 확인한다. 세 번째 동일 finding이거나 `review_rework_count >= 3` 또는 `total_rework_count >= 6`이면 `BLOCKED`로 전환한다. 그 외에는 두 rework counter를 각각 1 증가시키고 좁은 BUILD_FIX task로 전달한다.

Review 재작업 흐름은 반드시 다음과 같다.

`REVIEW CHANGES_REQUIRED -> BUILD_FIX -> RE_QA -> RE_REVIEW`

Review가 요청한 code/test/workflow/docs 변경 뒤 QA를 생략하지 않는다. RE_QA가 실패하면 QA rework counter와 모든 limit을 적용하여 BUILD_FIX와 RE_QA를 반복하고, PASS한 뒤에만 RE_REVIEW를 실행한다.

### 6. SHIP

다음 조건을 모두 만족할 때만 SHIP agent를 호출한다.

- latest QA verdict가 `PASS`
- latest Review verdict가 `PASS`
- unresolved CRITICAL count가 0
- unresolved MAJOR count가 0
- accepted SPEC/PLAN 밖 변경이 없음
- protected paths가 보존됨

SHIP agent는 현재 working tree의 기존 `$yaho-ship` 계약을 처음부터 끝까지 따른다. root는 finding/metrics 원장과 검증 근거를 전달하고, commit/PR/check/merge/METRICS/cleanup/final-main 결과를 검증한다.

SHIP 중 현재 변경으로 GitHub CI가 실패하면 CI failure count를 기록한다.

- 구현 결함이면 `ci_implementation_rework_count`가 3 미만일 때만 1 증가시키고 `BUILD_FIX -> RE_QA -> RE_REVIEW` 후 SHIP을 재개한다. 이미 3이면 `BLOCKED`로 전환한다.
- credential, Production approval 또는 외부 서비스 권한이 필요하면 사용자 stop condition으로 멈춘다.
- 확인된 일시적 외부 실패는 같은 operation을 총 세 번까지만 시도한다. 세 번째 실패 후 `BLOCKED`로 전환하고 실제 CI 실패 횟수를 숨기지 않는다.

## Production schema gate

기존 `$yaho-ship`의 현재 release 정책을 그대로 적용한다.

schema change가 없으면:

- `production-migrate`는 SKIP이어야 한다.
- `production-schema-gate`는 PASS여야 한다.
- Production DB에 접근하지 않는다.
- 모든 required CI가 PASS한 뒤에만 merge한다.

schema change가 있으면:

- 기존 migration 수정/삭제를 허용하지 않고 새 migration만 사용한다.
- GitHub `production` Environment의 human approval을 요구한다.
- root와 agent는 approval을 자동 수행하지 않는다.
- exact PR head 검증, migration-specific preflight, `prisma migrate deploy`, post-status 및 현재 ship의 post-deploy 검증을 모두 통과해야 한다.
- Production approval 시점에는 사용자에게 멈추고, 승인 완료 후 동일 상태에서 재개한다.

절대 다음을 수행하지 않는다.

- `main` 직접 push
- force push
- `git add .` 또는 `git add -A`
- secret/env credential commit 또는 출력
- failed CI 상태 merge
- QA 또는 Review 우회
- Production `prisma db push`
- Production `prisma migrate reset`
- Production `prisma migrate resolve`
- Production `prisma db seed`
- applied migration 자동 rollback

## Finding 및 METRICS

재작업은 자동으로 수행하되 다음 값을 정확히 추적하여 SHIP에 전달한다.

- QA rejection count: 공식 QA verdict가 `CHANGES_REQUIRED`인 횟수
- CRITICAL/MAJOR count: 실제 finding event와 unresolved 상태를 구분하여 기록
- rework count: 프로젝트 `docs/METRICS.md` 정의에 따라 QA/Review에서 BUILD_FIX로 반환된 횟수
- CI failure count: 실제 GitHub CI 실패만 집계하고 local test/build 실패와 구분
- primary cause: 기존 `docs/METRICS.md` 분류와 행 기록 규칙을 사용

control counter는 자동 실행 상한을 위한 값이고 METRICS 값은 기존 `docs/METRICS.md` 정의를 따른다. transient CI retry는 implementation rework로 계산하지 않으며, CI 원인의 BUILD_FIX는 QA/Review rework와 별도 origin으로 기록한다. SHIP agent가 기존 METRICS append-only 규칙에 따라 최종 값을 계산하도록 원장과 evidence를 전달한다. 재시도 또는 같은 finding의 반복을 숨기지 않되 stable ID로 재발 관계를 보존한다.

## 사용자에게 멈추는 조건

다음 경우에만 사용자 입력을 요청한다.

1. unresolved product/business decision
2. requirements conflict이고 accepted ADR로 해소되지 않음
3. destructive/risky operation에 명시적 결정 또는 새로운 권한이 필요함
4. Production Environment human approval이 필요함
5. external credential/value를 사용자가 제공해야 함

repository/source of truth만으로 해결할 수 없거나 자동 실행 limit에 도달한 기술 문제는 `USER_DECISION`이 아니라 `BLOCKED`로 종료하고 blocker 정보를 보고한다.

다음 사유만으로는 멈추지 않는다.

- QA code finding
- Review code finding
- 현재 구현 결함으로 인한 unit/E2E/lint/type/build 실패
- 현재 변경으로 인한 일반적인 CI 실패

이들은 finding을 정리하여 유한한 counter 범위에서 BUILD_FIX로 자동 routing한다. limit에 도달하면 `USER_DECISION`으로 재분류하지 않고 `BLOCKED`로 보고한다. 사용자가 agent 간 finding을 복사하거나 다시 설명하게 하지 않는다.

## 재개 규칙

사용자가 결정, credential 또는 human approval을 제공하면 완료된 단계를 처음부터 반복하지 않는다. state 원장을 갱신하고 멈춘 단계의 최소 선행 검증부터 재개한다. pause 중 branch/HEAD/working tree 또는 외부 PR 상태가 달라졌다면 먼저 drift를 확인한다.

`BLOCKED`는 자동 재개하지 않는다. 사용자가 명시적인 recovery direction을 제공하면 저장된 state와 counters를 보존한 채 blocker가 해소됐는지 먼저 검증하고 재개 여부를 판단한다.

## 단계별 검증

각 단계 전환 전 root는 다음을 확인한다.

- agent가 지정된 role과 기존 skill의 출력/권한 계약을 지켰는가
- 허용되지 않은 파일 또는 외부 상태를 변경하지 않았는가
- protected untracked가 보존되었는가
- accepted SPEC의 acceptance criteria가 누락되지 않았는가
- PLAN과 실제 diff가 일치하는가
- required tests와 근거가 실제로 존재하는가
- schema/migration 분류가 정확한가
- 다음 단계의 gate가 충족되었는가

최종 완료는 feature code와 필요한 METRICS가 기존 SHIP 계약에 따라 merge되고, branch cleanup과 final main 상태 확인까지 끝난 경우다.

## 최종 보고

진행 중에는 stage, verdict, 재작업 이유와 user stop condition만 간결하게 알린다. 완료 또는 중단 시 다음 형식을 사용한다.

```text
# YAHO Orchestration Report

## State
## Stage Results
## Findings / Rework
## Validation
## Ship
## Git State

Overall: COMPLETE / STOP_USER_DECISION / BLOCKED
```

`STOP_USER_DECISION`은 내부 `USER_DECISION` 상태의 사용자-facing 결과다. 최종 보고만으로 branch, gate, unresolved finding, Production approval, PR/merge 및 다음 action을 판단할 수 있어야 한다.
