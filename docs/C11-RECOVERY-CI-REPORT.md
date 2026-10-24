# C11 중단·재접속 복구 — 실제 PostgreSQL CI 증거 보고서

**CI 결과: 8 test files / 130 tests, 129 passed / 1 failed, job conclusion `failure`. 유일한 실패 D4는 실제 PostgreSQL 16에서 관측된 새 키 재입력 중복 기록 결함(MAJOR)이다. S1–S6 판정은 PASS 0 / FAIL 1 / BLOCKED 5이며, 본 문서는 C11 해소 선언이 아니다.**

## 1. 범위와 증거 기준

- 대상은 `test/c11-recovery`, HEAD `dc63ecd56c18e552d4e7d6bcd15fd492fabf360c`의 C11 서버 검증이다. 기존 CI 로그·테스트 코드·계획서·보고서와 사용자 제공 QA 결론을 대조했다. 이번 문서 작업에서 테스트·CI를 새로 실행하거나 DB에 접속하지 않았다.
- `AGENTS.md` 및 `.agents/skills/yaho-qa/SKILL.md`의 요건별 증거 추적을 적용했다. 일반적인 QA 파일 수정 금지에 대해서는 현재 사용자의 명시적 DOCS ONLY 지시를 우선하여 **이 파일 한 개만 신규 작성**한다. 구현 승인이 아니다.
- 요구 근거는 `REQUIREMENTS.md:2094–2105`, `:2127`, `:2149–2151`, `docs/DECISIONS.md:539`의 ADR-060, `ARCHITECTURE.md:128`의 잠금 후 판정 원칙이다. 실제 입금 기록·중복 배정 방지·원장 보존·확정 시 Payment 1회 연결·반환 누계와 상한을 구분해 평가한다.
- **관측(CI)**은 지정 Run의 실행 로그와 테스트 assertion으로 확인한 서버/DB 결과다. **정적 확인**은 현재 SHA의 코드 사실, **추론**은 그 코드로 설명하는 원인·다른 경로의 가능성이다. 브라우저·운영자 실행이 없는 항목은 **미검증**으로 남긴다. QA 결론보다 로그와 코드를 우선했으며, 아래 S1–S6 결론과 충돌하는 실행 근거는 발견하지 못했다.
- `docs/C11-RECOVERY-PLAN.md`와 `docs/C11-RECOVERY-REPORT.md`는 작업 시작부터 존재하던 미추적 입력 파일이다. 그 문서의 실DB 미실행·중복 미관측·S1–S6 모두 BLOCKED는 **과거 검증 시점의 기록**이다. 이번 CI 서버 증거를 그 과거 실행에 합산하거나 원문을 고치지 않는다.
- 로컬 Memory의 `MEMORY.md`와 `current.md`는 보조 자료로만 읽었다. `agent-memory-repo/SKILL.md`는 설치·프로젝트·Memory 및 `/opt`, `/tmp` 검색에서 찾지 못했으므로 스킬을 실행했다고 주장하지 않는다. Memory는 변경하지 않았다.

## 2. CI 식별 정보와 원본 증거

| 항목 | 확인값 / 근거 |
| --- | --- |
| Repository | `gulatnaru/yaho-management` |
| Run ID / attempt | [40109346396](https://github.com/gulatnaru/yaho-management/actions/runs/40109346396) / 1 |
| Workflow / 파일 | `Phase 2 PostgreSQL Integration` / `.github/workflows/phase2-integration.yml` |
| 트리거 | `workflow_dispatch` — Run 메타데이터로 확인. PR 트리거 실행이 아니다. |
| Branch | `test/c11-recovery` — 로컬 Git, Run 메타데이터, full 로그 :185–199 일치 |
| Head / 실제 checkout SHA | `dc63ecd56c18e552d4e7d6bcd15fd492fabf360c` (`dc63ecd`) — Run 메타데이터 및 full 로그 :199 |
| Run 시작 / 최종 갱신 | `2026-10-24T15:57:48Z` / `2026-10-24T15:59:04Z` (UTC). KST로는 2026-10-25 실행이다. |
| Job | [`integration` / 120917617117](https://github.com/gulatnaru/yaho-management/actions/runs/40109346396/job/120917617117), `completed` / `failure` |
| DB | 폐기 가능한 CI `postgres:16` service. `Verify PostgreSQL` 출력은 PostgreSQL 16 / database·user `yaho_e2e` (full :308). 접속 URL·비밀번호는 전재하지 않는다. |
| 격리 수준 검증 | T11 :59–69, :308의 runtime guard가 PG16·전용 DB/user·`read committed`를 요구한다. 다른 격리 수준의 검증 근거가 아니다. |
| 실행 명령 | `npx vitest run --config vitest.integration.config.ts` (full :384–393), Vitest 2.1.9 |
| 실행 요약 / 종료 | full :578–581의 8 files / 130 tests / 13.81초, :669의 exit code 1 |
| PR #54 | [기존 PR #54](https://github.com/gulatnaru/yaho-management/pull/54)는 읽기 전용 조회에서 OPEN / Draft / unmerged 확인. 이번 Run은 별도 테스트 브랜치의 실행이며 PR #54 최종 검증으로 전용하지 않는다. PR 생성·수정·push 없음. |

GitHub Run·job·PR 메타데이터는 이번에 읽기 전용으로 대조했다. Job의 준비·PostgreSQL 확인·migration 적용 단계는 success, `Integration tests` 단계는 failure다. 후처리·컨테이너 종료 단계의 success는 실패한 테스트나 job conclusion을 바꾸지 않는다. CI의 폐기 DB migration 실행은 기존 Run의 사실이며 이번 문서 작업의 migration 실행이 아니다.

이하 **T11**은 `tests/integration/reservation-applications/c11-recovery.test.ts`, **full**은 `/tmp/c11-ci-full.log`, **failed**는 `/tmp/c11-ci-failed.log`다. `파일:행`은 현재 입력 파일의 행 번호다. 두 로그는 같은 Run의 전체/실패 로그이므로 별도 두 번의 실행으로 세지 않는다. `/tmp` 파일은 로컬 입력이며 저장소에 추가하지 않았다.

| 입력 | SHA-256 |
| --- | --- |
| T11 | `7176556f00ecf2817fa8da5747332f74025a9a0913ae04846019fbb2c54305f4` |
| full (761행) | `9aa26d48607b4707f24ad33023b87631f8d8f139702594ac383d0af9cc92ca89` |
| failed (286행) | `822bdc78a9aca6798fc320d2e8bd970caf24f9f9c00b81e91a296273665293db` |
| `docs/C11-RECOVERY-PLAN.md` | `304e7dea93c09d22067e6d8cc84848bcb7d0ada55b3d955a8ea07cee9d3e3c96` |
| `docs/C11-RECOVERY-REPORT.md` | `012323cb3ee0fa774551550de75e331c9a66eca8ca2ca386f920cdb68b3d85bf` |

## 3. 전체 결과표

아래 파일은 모두 `tests/integration/reservation-applications/` 아래에 있다. PASS는 해당 서버 suite의 assertion 통과이며 브라우저 시나리오 완료 판정이 아니다.

| Test file | Tests | Passed | Failed | 결과 | full 근거 |
| --- | ---: | ---: | ---: | --- | --- |
| `payment-refund-concurrency.test.ts` | 20 | 20 | 0 | PASS | :395–402 |
| `c11-recovery.test.ts` | 23 | 22 | 1 | FAIL — D4 | :412–418 |
| `price-recheck.test.ts` | 26 | 26 | 0 | PASS | :419 |
| `confirmation-atomicity.test.ts` | 26 | 26 | 0 | PASS | :456 |
| `class-link-issuance.test.ts` | 12 | 12 | 0 | PASS | :457 |
| `workflow-races.test.ts` | 10 | 10 | 0 | PASS | :458 |
| `family-queries.test.ts` | 7 | 7 | 0 | PASS | :459 |
| `detail-queries.test.ts` | 6 | 6 | 0 | PASS | :460 |
| **합계** | **130** | **129** | **1** | **7 files passed / 1 file failed / job failure** | **:578–579** |

failed :195–198도 같은 합계를 기록한다. D4의 soft assertion 네 개가 각각 실패 상세로 출력되지만 **실패한 test는 한 개**다(full :462–576). 이 Run에 PASS·FAIL 외 skip 수는 표시되지 않았고, T11에 skip/expected-failure 선언은 없다.

## 4. 셀별 통과표 — 서버 증거에 한정

CI 기본 reporter가 개별 PASS 이름을 모두 열거하지 않으므로 T11의 23 tests / 1 failed, 유일한 D4 실패 이름과 코드의 셀 목록을 대조했다. 아래 parameterized case를 포함한 합계는 **22 PASS / 1 FAIL = 23**이다.

| 셀 | Case 수 / 결과 | 실제 확인한 동작·무변경 기준 | T11 근거 |
| --- | --- | --- | --- |
| D1 | 1 / PASS | 동일 키·동일 payload replay가 같은 응답을 반환하고 Deposit 1행·배정 1행 및 전체 snapshot 유지 | :312–323 |
| D2 | 3 / PASS | 동일 키의 금액·입금자명·입금일시 변경을 각각 failure로 거부하고 snapshot 무변경 | :325–335 |
| D3 | 1 / PASS | commit 완료 응답을 호출자가 폐기한 뒤 알려진 키 조회·새 상세 조회로 같은 Deposit 식별, 추가 쓰기 없음 | :337–349 |
| D4 | 1 / **FAIL** | 같은 합성 은행 사건을 새 키로 재입력하여 Deposit 2행·배정 3행 관측. §5 참조 | :351–368 |
| D5 | 1 / PASS | 독립 PG client 두 개의 동일 키 경합에서 두 응답의 receipt 일치, Deposit 1행·배정 1행 | :370–379 |
| R1 | 2 / PASS | 부분 20,000원·전액 60,000원 각각 같은 키 replay. 오래된 원본 관측값이어도 기존 응답·반환 1행·누계·resolvedAt 유지 | :381–397 |
| R2 | 2 / PASS | 새 키의 stale 관측 의무액 / 반환 누계를 각각 거부, 전체 snapshot 무변경 | :399–409 |
| R3 | 1 / PASS | commit 응답 폐기 후 상세·반환 조회·알려진 키 receipt에서 같은 반환 행과 완료 누계 확인, 추가 쓰기 없음 | :411–424 |
| R4 | 1 / PASS | 새 키·최신 관측값으로 별도 부분반환 허용. 배정 유지, 잔액 초과·완료 후 추가 반환은 무변경 거부 | :426–445 |
| C1 | 1 / PASS | 독립 PG client 두 개의 확정 경합에서 success 1 / failure 1, Payment 1·Reservation/items/mappings 각 2 및 실제 연결 일치 | :447–456, :194–211 |
| C2 | 1 / PASS | 확정 응답 폐기 후 CONFIRMED와 실제 Reservation/PaymentItem/Mapping/Payment 연결 조회. 반복 확정 거부·전체 기존 연결 유지 | :458–469 |
| C3 | 1 / PASS | 같은 tx 내부의 실제 Reservation/Child/동의/Payment/items/mappings 및 첫 배정 쓰기 뒤 예외 주입. 요청 종료 후 새 snapshot에서 전체 rollback 확인 | :471–510 |
| C4 | 1 / PASS | legacy core 확정의 실제 Reservation 조회·반복 거부, 자동 Payment/items/mappings 0. item 없는 Payment 부모 신규 생성도 없음 | :512–539 |
| L1 | 2 / PASS | deposit/return key-only 조회가 기존 receipt를 찾고 snapshot 무변경. 원본 payload 비교를 증명하는 셀은 아님 | :541–560 |
| L2 | 2 / PASS | deposit/return FormData 조회에서 원본 입력 일치 성공 및 금액·이름/사유·일시 변경 거부, snapshot 무변경 | :561–573 |
| L3 | 2 / PASS | 제출한 적 없는 임의 키는 key-only/FormData 모두 not-found, 쓰기 없음. 원 요청 rollback·종료를 증명하지 않음 | :574–582 |

T11 :11–15는 ADMIN principal과 Next cache/navigation을 test seam으로 대체한다. DB 쓰기와 금융 액션은 실제지만 로그인·HTTP·브라우저 통합 검증은 아니다. D5/C1은 :228–305에서 Submission 잠금 barrier, 독립 worker/controller/observer PID 네 개, 실제 lock wait·blocking graph를 assertion으로 확인한다. 이는 독립 DB 요청의 경합 증거이며 실제 운영자 두 명의 UI 조작 증거로 확대하지 않는다. 응답 폐기는 함수 반환값을 받지 않는 모델이며 실제 reload·tab close·네트워크 단절이 아니다(T11 :1–5).

## 5. D4 결함 분석

**Severity: MAJOR. 실제 PG16에서 관측된 중복 기록 결함이다.**

### 재현 방법과 기대 동작

1. T11 fixture의 같은 Submission에 40,000원·60,000원 신청을 만들고, 60,000원 신청을 반려한다(:98–116, :167–169, :352).
2. 합성 실제 입금 100,000원을 기록한다. 첫 호출의 결과·키는 호출자가 보유하지 않으며, snapshot의 Deposit 1행·배정 1행을 확인한다(:353–356).
3. **같은 Submission·금액·입금자·입금일시**의 동일 합성 은행 사건을 새 키로 다시 입력한다(:357–360). `deposit()`의 기본 키는 매번 새 UUID이며 나머지 입력은 같다(:30, :47–49).
4. 두 번째 호출 종료 뒤 새 snapshot과 `ledger()`를 읽어 기존 한 건의 기록·배정·totals가 유지되는지 검사한다(:361–367).

기대는 Deposit **1행**, 기존 Deposit ID와 원래 배정 **1행 그대로**, `D=100,000 / A=40,000 / P=0 / R=60,000 / T=0`이다. fixture가 하나로 정의한 은행 사건을 새 UUID 때문에 두 거래로 간주하지 않는다.

### 관측 사실 — 코드와 CI assertion 대조

| 항목 | 단일 입금 기대 | 관측값 | 근거 |
| --- | --- | --- | --- |
| Deposit 건수 / ID | 1 / 기존 ID만 | **2 / 새 ID 추가** | T11 :363–364, full :464–493, failed :81–110 |
| FundAllocation | 원본 1행 유지 | **3행**. 기존 60,000원 배정에 40,000원·60,000원 배정 추가 | T11 :365, full :506–537, failed :123–154 |
| D — 확인 입금 합계 | 100,000 | **200,000** | T11 :366, full :550–565, failed :167–182 |
| A — 미배정 가용액 | 40,000 | 40,000 | 같은 totals diff |
| P — Payment 배정 | 0 | 0 | 같은 totals diff |
| R — 반환 필요 잔액 | 60,000 | **160,000** | 같은 totals diff |
| T — 완료 반환 | 0 | 0 | 같은 totals diff |

실패는 Deposit 건수·ID, 배정 불변, 단일 입금 totals 기대의 네 soft assertion이다. `ledger()`의 별도 무결성 assertion(T11 :120–159)을 지난 뒤 이 실패들이 기록됐다. `noConfirmation()`(:161–166, :367)은 Reservation/Payment/items/mappings가 생성되지 않았음을 검사한다. 이 셀에서 실제 은행 입금·송금이 두 번 실행되었다거나 Preview/Production 데이터가 오염되었다는 관측은 없다. 합성 은행 사건의 **DB 중복 기록**을 관측한 것이다.

### 정적 확인과 추론의 경계

| 구분 | 설명 |
| --- | --- |
| 정적 확인 | `app/(admin)/reservation-applications/actions.ts:231–238`은 Submission 잠금 아래 기존 **키**의 payload를 비교한다. `server/reservation-applications/finance.ts:194–208`은 같은 Submission을 잠그고 키가 있으면 그 키를 조회하며, 기존 키가 없으면 Deposit 생성 후 반환 의무·배정을 조정한다. 새 키 요청에서 같은 네 필드의 기존 입금을 찾는 검사는 이 경로에 없다. |
| 원인 해석 — 추론 | 키 기반 replay 방어가 새 키로 들어온 동일 합성 은행 사건을 식별하지 못하여 신규 기록·배정이 가능하다는 설명이 D4 관측과 일치한다. Submission 잠금에 따른 직렬화와 현실 거래 식별은 별개다. D4 자체는 순차 재입력이며 서로 다른 새 키 두 개의 동시 요청 셀은 아니다. |
| 미검증 | 실제 reload로 키가 소실된 뒤 같은 UI 경로에서 재입력하는 전체 과정, 운영자의 동일 거래 판별, 실제 은행 거래 식별 가능성은 이 CI로 검증하지 않았다. 네 필드가 같은 모든 현실 입금이 같은 은행 사건이라고 단정하지 않는다. |

## 6. S1–S6 최종 판정 — 라벨과 적용 범위

사용자 제공 QA 결론을 위 실행 근거와 대조한 결과다. D4 제목에 S1·S6가 모두 적혀 있어도 실제 reload를 실행한 것으로 세지 않는다. S6 FAIL은 서버 재시도 부분에서 관측한 결함에 근거하고, S1은 요구된 브라우저 새로고침 시나리오의 BLOCKED를 유지한다.

| 시나리오 | 최종 판정 | 적용 범위와 실행 근거 | 판정의 한계 |
| --- | --- | --- | --- |
| S1 입금 응답 유실 + 새로고침 | **BLOCKED** | D1/D2/D3/D5의 서버 replay·거부·응답 폐기 후 조회·동일 키 경합 통과. 공유하는 D4 서버 중복 결함은 확정 | 실제 reload·새 context 복구 재현으로 확장하지 않는다. 서버 결함이 없다는 판정도 아님 |
| S2 반환 중 탭 종료 + 재접속 | **BLOCKED** | R1–R4의 replay·stale 거부·완료 기록 조회·합법 부분반환 및 상한 통과 | 실제 tab close와 재접속·운영자 완료 기록 대조 미검증 |
| S3 확정 중 단절 + 재접속 | **BLOCKED** | C1–C4의 1회 확정·실제 연결 조회·반복 거부·중간 실패 rollback·legacy 자동 Payment 0 통과 | 실제 단절·선택 소실 후 새 context에서 원래 요청과 연결을 확인하는 과정 미검증 |
| S4 DB 성공 / 브라우저 실패 표시 | **BLOCKED** | D3/R3/C2 및 L1–L3의 서버 기록·receipt 조회 근거 확보 | 실제 UI 실패 표시 및 후속 gate 연결·갱신 실패 처리 미검증 |
| S5 기존 기록으로 최종 판별 | **BLOCKED** | 상세/반환/확정 연결 및 key-only·FormData·not-found 서버 분기 확인 | 키 없는 운영자의 유일 대응·조회 실패·미결·not-found 오판 여부 미검증 |
| S6 잘못된 재시도·중복 클릭 | **FAIL** | **서버 재시도 범위에서 D4 중복 관측**. 동일 키·변경 payload·반환 상한·확정 경합의 통과 증거와 함께 평가 | 실제 UI double click·context 소실·재접속 후 수동 재입력·운영자 간 조작·판단은 계속 미검증 |
| **집계** | **PASS 0 / FAIL 1 / BLOCKED 5** | 시나리오 판정 6개 | 서버 test 23개의 22/1 집계와 다른 단위 |

## 7. C10·원장 평가

### 원장 보존과 현실 거래 중복

`D = A + P + R + T`에서 D는 기록된 확인 입금, A는 가용액, P는 Payment 배정, R은 미완료 반환 필요 잔액, T는 완료된 Reservation 전 반환이다. T11 :128–147은 저장 원천에서 합계를 재계산하고 행별 배정 상한·배정 대상·반환 이력 합계/누계·완료 상태도 대조한다.

D4 관측값은 `200,000 = 40,000 + 0 + 160,000 + 0`으로 보존식을 만족한다. **행들 사이의 원장 보존식 위반은 관측되지 않았다. 보존식 만족은 현실 거래 무중복의 충분조건이 아니다.** 중복 입금이 D와 반환 배정을 함께 늘리면 식은 맞을 수 있다. 따라서 단일 입금 기대 totals 불일치를 보존식 자체의 파손으로 기록하지 않으며, 보존식 통과를 D4 무중복 PASS로 바꾸지도 않는다.

R1–R4는 `sum(ApplicationReturn.amount)=returnedAmount`, 상한·resolvedAt·R/T 및 기존 배정을 확인하고, C1–C3는 quote별 실제 연결·Payment 배정·원자성을 확인한다. C4의 원장 0은 별도의 현대식 Submission fixture에 대한 검사이며 legacy 금액을 임의로 기록한 것이 아니다. 이 범위의 통과가 미실행 브라우저 상태 소실을 검증하지는 않는다.

### C10 회귀와 6D 완료 경계

`payment-refund-concurrency.test.ts`는 **20/20 PASS**다(full :395–402). C10 forced interleaving은 서로 다른 worker PID 106/107이 모두 `parent-lock-wait`에 있음을 기록했다. 이 단계의 `aggregate: undefined`는 부모 선잠금에서 아직 집계를 수행하지 않은 출력이며, 원본 결함의 오래된 aggregate 관측으로 전용하지 않는다. 테스트 :376–417은 barrier·독립 PID·부모→item 순서·각 40,000원 Refund/누계·원장 불변을 검사한 뒤 최종 `Payment.status=REFUNDED`를 요구한다. suite 제목의 `ORIGINAL core regression`보다 실제 stage와 assertion을 근거로 평가한다.

같은 suite는 동일/다른 item 경합·상한, 독립 Payment 진행, 단계별 rollback, 양수 R/T·mapping/allocation 보존 및 Revenue 회귀도 포함한다. 이는 이번 SHA의 **서버 회귀 증거**다. 그러나 `docs/ITERATION-6D-PLAN.md:137–140`의 독립 QA/Review, exact fix/test SHA 연결, 전체 integration 및 quality CI, 최종 completion chain을 이 문서가 모두 닫은 것은 아니며 **해당 job은 failure**다. 따라서 **C10 최종 완료 PASS를 새로 부여하지 않는다.** C10의 환불 잠금은 C11의 잃은 키·선택을 복구하지 않는다.

## 8. 브라우저 미검증 범위 — 항목별

이 Run의 workflow는 integration config만 실행한다. 이번 문서 작업에서도 Playwright·앱 서버·브라우저·운영자 walkthrough를 실행하지 않았다. 아래 범위를 CI DB 테스트만으로 PASS 처리하지 않는다.

| 시나리오 | 남은 실제 브라우저·운영자 검증 |
| --- | --- |
| S1 | 실제 reload, 새 context에서의 복구, 키 보유/소실 및 원 요청 종료 후 서버 기록의 대응 |
| S2 | 실제 tab close 후 재접속, 부분/전액 반환의 완료 기록과 누계·잔액을 기존 화면에서 대조 |
| S3 | 실제 네트워크 단절, 선택 소실 후 재접속, CONFIRMED와 실제 Reservation/PaymentItem/Mapping/Payment 연결 확인 |
| S4 | 실제 UI 실패·결과 불명확 표시, 저장 확인·후속 gate 연결, 후속 조회 실패 때의 차단 |
| S5 | 키 없는 운영자 walkthrough. 유사 거래 복수·조회 실패·원 요청 미결·not-found를 최종 미저장/rollback으로 오판하는지 확인 |
| S6 | 실제 double click, context 소실·재접속 후 수동 재입력, 운영자 간 조작 및 대응 거래 판단 |

L3의 not-found는 한 번도 제출하지 않은 임의 키를 조회한 결과다. 진행 중인 원 요청의 종료·rollback을 증명하지 않는다. R4는 **별도의 정당한 부분반환**을 허용하는 셀이므로 새 키가 같거나 다른 현실 은행 이체를 완전히 식별한다는 증거로 읽지 않는다.

## 9. 최소 수정 SPEC/PLAN 제안 — 구현·승인 아님

### 제안 계약과 최소 범위

- 기존 Submission 잠금 안에서 **새 Deposit 생성 전**, 동일 Submission·금액·**파싱된 입금자명·입금일시**의 기존 기록이 있으면 **의심 중복으로 신규 기록을 거부**하고 기존 기록 확인을 안내한다. 기존 파서의 입력값을 기준으로 하며 새 비교용 필드·hash를 제안하지 않는다.
- 동일 키·동일 payload replay와 동일 키·변경 payload 거부 계약을 유지한다. 기존 키 처리 뒤, 실제 신규 생성으로 진행할 때 의심 중복을 검사하는 순서를 제안한다. **새 키를 기존 거래의 성공 receipt로 자동 간주하지 않는다.**
- 변경 후보는 `server/reservation-applications/finance.ts:195–204`의 **Deposit core 잠금 후·생성 전 검사**와 `app/(admin)/reservation-applications/actions.ts:240–241`의 **명시적인 업무 오류 처리**에 한정한다. 의심 중복 거부를 저장 성공이나 원인 불명의 인프라 실패로 표시하지 않고 기존 기록 확인을 안내하는 계약을 SPEC에서 정한다.
- 거부 시 **Deposit·반환 의무·배정 전체 무변경**이어야 한다. 기존 Submission 잠금 아래 검사와 생성을 함께 두어 서로 다른 새 키 두 개의 동시 동일 입력도 직렬화된 검사로 한 번만 기록하도록 검증한다. 새로운 잠금 순서·금융 배정 정책을 임의로 추가하지 않는다.
- **네 필드만으로 은행 사건 동일성을 완전히 증명할 수 없다.** 동일 필드의 정당한 별도 입금 처리 방식은 **SPEC 승인 시 명확히 해야 할 사항**이다. 영구 UNIQUE 제약·자동 병합 정책을 임의 확정하지 않는다. 그 결정 없이 이 제안만으로 구현에 착수하지 않는다.
- 자동 재시도·키 영속화·새 receipt route·전면 멱등성 정책은 포함하지 않는다. 6E 개인정보 정책·ADR-066 및 K04의 실제 재시도 계약을 이번 제안으로 변경·승인하지 않는다.

### 향후 승인된 BUILD·QA의 회귀 기준

| 대상 | 통과해야 할 기준 |
| --- | --- |
| D4 원래 oracle | **Deposit 1행·기존 ID·기존 배정 유지**, 원래 totals `D=100,000 / A=40,000 / P=0 / R=60,000 / T=0`. 의심 중복 거부 후 Deposit/반환 의무/배정 snapshot 전체 무변경 |
| 서로 다른 새 키 동시 요청 | 같은 Submission·동일 입력을 새 키 두 개로 동시에 제출해 **한 번만 기록**. 다른 요청은 의심 중복 거부, 기존 거래의 성공 receipt 자동 재생 없음 |
| 기존 T11 | D1/D2/D3/D5·R1–R4·C1–C4·L1–L3 계약과 원장 assertion 유지 |
| 인접·전체 회귀 | `workflow-races.test.ts`, `tests/unit/reservation-applications/admin-actions.test.ts`, 전체 integration **C10 포함** 유지. 승인된 변경에는 repo 규칙의 lint/test/build 또는 dev 실행 시 대체 검증 적용 |
| 실제 브라우저·운영자 | 기존 `tests/e2e/integrated-ux-ledger.spec.ts`, `integrated-ux-confirmation.spec.ts` 및 walkthrough로 §8 범위를 실행하고 **S1–S5와 S6 남은 범위 재판정** |

**D4를 2행 기대·expected failure·skip으로 바꾸는 것은 판정 기준이 아니다.** 서버 수정·그 회귀 통과만으로 브라우저 전체 복구나 C11 해소를 자동 선언하지 않는다.

## 10. 작업 경계

6E 개인정보 정책·ADR-066 변경 없음. ADR-066의 방향 승인과 아직 미승인인 세부 실행·K04 계약의 구분을 유지한다. 제품 코드·테스트·설정·워크플로·마이그레이션 변경 없음. Preview/Production 데이터 접근 없음. PR 생성·PR #54 변경/push·commit·push·main push·merge·운영 배포 없음. Production Schema Gate 승인 없음. C11 최종 해소 여부는 별도 판단이며 이 문서는 해소 선언이 아니다.

## Completion Report

### Changed

`docs/C11-RECOVERY-CI-REPORT.md` 한 파일만 신규 작성. 기존 계획서·보고서·테스트와 Git branch/HEAD/index를 보존했다. commit/push 없음, PR #54 Draft 유지.

### Tests

기존 Run **40109346396 / dc63ecd**의 로그·코드 대조: **8 files / 130 tests / 129 passed / 1 failed**, job failure. T11은 **22/23 PASS, D4 FAIL(MAJOR)**. C10 suite **20/20 PASS**는 서버 회귀 증거이며 C10 최종 완료 PASS는 부여하지 않는다. S1–S6은 **PASS 0 / FAIL 1 / BLOCKED 5**. 이번 로컬 테스트·CI 재실행·브라우저 실행 없음.

### Lint

애플리케이션 lint 미실행 — DOCS ONLY. `git diff --check` exit 0. 신규 미추적 파일의 `git diff --no-index --check /dev/null docs/C11-RECOVERY-CI-REPORT.md`는 exit 1, 진단 출력 0이었다. 별도 문서 검사로 공백·최종 newline·표 합계·필수 항목·참조 파일·입력 해시를 확인했다(PASS). 기존 884개 파일의 내용 fingerprint 및 branch/HEAD/index 보존도 확인했다. 앱 lint 통과로 표기하지 않는다.

### Build

미실행 — DOCS ONLY. 앱 dev/build 서버 기동 및 DB 연결 없음.

### Risks

D4의 새 키 중복 기록 결함이 남아 있다. 관측된 행 사이 보존식은 성립해도 현실 거래 무중복을 보장하지 않는다. §8의 브라우저·운영자 복구는 미검증이며, 6D 완료 chain과 C11 최종 해소를 선언하지 않는다. 네 필드가 같은 정당한 별도 입금의 처리 계약은 SPEC 승인 때 명확히 해야 한다.

### Next

최소 수정 제안을 별도 SPEC/PLAN 승인 대상으로 검토하고, 승인된 BUILD·회귀 및 브라우저/walkthrough 증거 후 남은 판정을 갱신한다. 이번 작업은 문서 작성으로 끝나며 구현·승인·Git/배포 작업으로 진행하지 않는다.
