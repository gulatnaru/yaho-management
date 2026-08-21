# YAHO Decision Log (ADR)

결정과 그 이유를 남긴다.
기록이 없으면 다음 세션의 에이전트가 같은 논쟁을 반복하거나, 이미 내린 결정을 뒤집는다.

## 작성 규칙
- 결정이 내려진 시점에 즉시 추가한다.
- 이미 기록된 ADR은 수정하지 않는다. 번복할 경우 새 ADR을 추가하고 이전 것을 Superseded로 표시한다.
- Analyst가 주 작성자다. Architect도 설계 결정을 기록할 수 있다.

## 템플릿

```text
## ADR-000: 제목
- Status: Accepted / Superseded by ADR-00N
- Date: YYYY-MM-DD
- Context: 무엇 때문에 결정이 필요했는가
- Decision: 무엇으로 정했는가
- Reason: 왜 그렇게 정했는가
- Consequences: 이 결정으로 포기하는 것, 나중에 비용이 될 수 있는 것
```

---

## ADR-001: 고객의 기본 단위를 아이 1명으로 한다
- Status: Accepted
- Date: 2026-08-18
- Context: 형제/자매가 함께 참여하거나 친구끼리 함께 신청하는 경우가 많다.
- Decision: 고객 1명 = 아이 1명. 보호자 정보는 아이 정보에 포함한다.
- Reason: 예약/결제/환불이 모두 아이별로 발생한다. 보호자를 단위로 잡으면 환불 처리가 복잡해진다.
- Consequences: 형제 2명은 아이 2건으로 등록되어 보호자 정보가 중복 저장된다. 보호자 연락처 일괄 변경이 필요해지면 별도 Entity 분리를 재검토한다.

## ADR-002: 클래스 전체 취소와 개인 예약 취소를 분리한다
- Status: Accepted
- Date: 2026-08-18
- Context: 야외 프로그램 특성상 우천 취소가 잦고, 개인 사정 취소도 별개로 발생한다.
- Decision: ClassSchedule의 취소와 Reservation의 취소를 별도 상태/사유로 관리한다. 클래스 취소 시 예약을 삭제하지 않는다.
- Reason: 취소 사유별 통계와 환불 책임 구분이 달라진다.
- Consequences: 클래스가 취소된 예약의 상태 표시 규칙을 UI에서 별도로 정의해야 한다.

## ADR-003: ReservationParticipant를 사용하지 않는다
- Status: Accepted
- Date: 2026-08-19
- Context: 초기 DB 설계에 예약 1건에 여러 참가자를 두는 구조가 있었다.
- Decision: 예약은 아이 1명 단위이므로 참가자 테이블을 두지 않는다.
- Reason: ADR-001과 충돌한다. 친구 3명 동반 신청은 Reservation 3건으로 생성한다.
- Consequences: "함께 예약" UI에서 여러 건을 한 번에 생성하는 처리가 필요하다.

## ADR-004: 정원 8명을 DB 제약에 하드코딩하지 않는다
- Status: Accepted
- Date: 2026-08-19
- Context: 요구사항상 클래스 정원은 최대 8명이다. 다만 기관 단체 수업이 도입되면 인원 기준이 달라질 가능성이 있다.
- Decision: capacity는 1 이상만 DB에서 보장하고, 기본값 8과 상한 8 검증은 서버 비즈니스 규칙으로 처리한다.
- Reason: 상한이 바뀔 때 migration이 아니라 규칙 변경으로 대응할 수 있다. 데이터 무결성(음수/0 방지)은 DB가 계속 보장한다.
- Consequences: 상한 검증이 서버에만 있으므로 해당 테스트를 반드시 유지해야 한다. QA 필수 항목이다.

## ADR-005: 기관 단체 건에 대비해 PaymentItem을 미리 도입한다
- Status: Accepted
- Date: 2026-08-19
- Context: 현재 기관 단체 신청은 없으나 확대할 계획이며, 결제는 기관 일괄과 보호자 개별이 모두 발생할 예정이다.
- Decision: Organization Entity는 지금 만들지 않는다. 대신 Payment와 Reservation 사이에 PaymentItem을 두어 결제 1건이 여러 예약을 포함할 수 있는 구조만 확보한다. 매출 집계는 PaymentItem 기준으로 작성한다.
- Reason: Organization은 nullable FK와 테이블 추가만으로 나중에 붙일 수 있어 비용이 낮다. 반면 Payment와 Reservation의 1:1 가정은 집계 로직 전체에 퍼지므로 나중에 바꾸면 재작성이 된다. 비싼 쪽만 미리 연다.
- Consequences: 당분간 PaymentItem은 항상 1건만 생성되어 테이블이 하나 늘어난 만큼의 형식적 비용이 있다. 기관 도입 시점에 Organization과 기관별 매출 집계는 별도 작업으로 남는다.

## ADR-006: 아동 안전 정보를 별도 테이블로 분리하고 수집 범위를 제한한다
- Status: Accepted
- Date: 2026-08-19
- Context: 야외 프로그램 특성상 알레르기와 비상연락처가 현장에서 반드시 필요하다. 그러나 건강 관련 정보는 민감정보이며, 기존 원칙은 "개인정보 최소 저장"이다.
- Decision: ChildSafetyInfo를 Child와 1:1 별도 테이블로 두고, 수집 범위를 "현장에서 즉시 대응하는 데 필요한 것"으로 한정한다. 진단명/병력/복용약 이력은 저장하지 않는다. 동의는 ChildConsent에 유형별로 기록하고 철회 가능하게 한다.
- Reason: 테이블을 분리하면 목록 조회에 딸려오지 않고 접근 제어와 감사 기록을 걸기 쉽다. 수집 범위를 제한하는 것이 최소 저장 원칙과 현장 필요를 동시에 만족시키는 방법이다.
- Consequences: 아이 상세 조회 시 join이 한 번 늘어난다. 민감정보 보관 기간과 파기 시점은 아직 미결정으로, 24장에 남겨두었다.

## ADR-007: 환불 상한을 PaymentItem.refundedAmount 컬럼으로 보장한다
- Status: Accepted
- Date: 2026-08-19
- Context: DATABASE.md 에 "Refund 합계 <= paidAmount 를 서버와 DB 제약으로 이중 보호" 라고 기록했으나, PostgreSQL 의 CHECK 제약은 같은 행 안에서만 검사할 수 있어 다른 Refund 행들의 SUM 을 볼 수 없다. 실제로는 서버만 막고 있었다.
- Decision: PaymentItem 에 환불 누계 컬럼 refundedAmount 를 두고 `CHECK (refundedAmount <= paidAmount)` 를 건다. 환불은 PaymentItem 행을 잠근 트랜잭션 안에서 Refund 생성과 refundedAmount 갱신을 함께 수행한다.
- Reason: 집계값을 컬럼으로 들고 있으면 행 단위 CHECK 로 상한을 강제할 수 있다. 트리거나 별도 제약보다 단순하고, 조회 시 합계를 매번 계산하지 않아도 된다.
- Consequences: refundedAmount 와 Refund 행 합계가 어긋날 수 있는 비정규화 위험이 생긴다. 환불 경로를 하나로 유지하고, 두 값의 일치를 QA 필수 항목으로 둔다.

## ADR-008: 동의 기록을 append-only 이력으로 관리한다
- Status: Accepted
- Date: 2026-08-19
- Context: ChildConsent 를 `unique(childId, consentType)` 로 두고 철회 시 revokedAt 만 갱신하는 구조였다. 이 경우 철회 후 재동의하면 이전 동의 시점이 덮어써져 이력이 사라진다. 요구사항 20-1.4 는 "동의 이력" 을 요구한다.
- Decision: unique 제약을 제거하고 동의/철회마다 행을 추가하는 append-only 구조로 바꾼다. action(AGREED/REVOKED)과 recordedAt 을 기록하고, 현재 상태는 최신 행으로 판단한다.
- Reason: 이력 테이블을 따로 두는 것보다 단순하다. "언제 동의했고 언제 철회했는가" 증빙이 그대로 남는다.
- Consequences: 현재 동의 여부를 알려면 최신 행을 조회해야 하므로 쿼리가 한 단계 늘어난다. (childId, consentType, recordedAt) 인덱스로 대응한다.

## ADR-009: CI에서 Playwright e2e를 아직 실행하지 않는다
- Status: Accepted
- Date: 2026-08-20
- Context: Phase 1 QA에서 tests/e2e/auth.spec.ts를 발견했으나 CI(.github/workflows/ci.yml)에는 실행 단계가 없다. e2e는 실제 DB에 대해 로그인 플로우를 검증해야 하는데, 테스트용 DB를 어떻게 프로비저닝하고 시딩/초기화할지에 대한 전략이 아직 정해지지 않았다.
- Decision: 테스트 DB 전략이 확정되기 전까지 CI에서 Playwright e2e 단계를 추가하지 않는다. e2e 테스트 파일 자체는 리포지토리에 유지하고 로컬에서 수동으로 실행한다.
- Reason: DB 전략 없이 e2e를 CI에 억지로 넣으면 flaky 해지거나, 목업으로 대체되어 실제 인증 흐름을 검증하지 못하는 테스트가 되어 회귀 방지 효과가 떨어진다. 테스트 DB 전략을 먼저 정한 뒤 정식으로 CI에 편입하는 것이 안전하다.
- Consequences: e2e로만 잡히는 회귀(예: 비인증 접근 시 /login 리다이렉트)는 PR마다 자동 검증되지 않는다. 테스트 DB 전략이 확정되면 CI에 Playwright 단계를 추가하는 후속 작업이 필요하다.

## ADR-010: 보호자 정보와 생년월일을 선택 입력으로 유지한다
- Status: Accepted
- Date: 2026-08-21
- Context: REQUIREMENTS.md 3.2는 "필수/선택 여부는 실제 화면 설계 단계에서 확정한다"고 남겨두었다. Phase 2 설계 초안에서 birthDate/guardianName/guardianPhone을 필수 입력으로 만드는 안을 제시했으나, 문의 단계의 아이를 이름만으로 먼저 등록하는 실제 운영 사례가 있어 반려되었다. 필수로 막으면 그 시점에 앱을 사용할 수 없게 된다.
- Decision: birthDate, guardianName, guardianPhone은 생성/수정 폼과 Zod 검증에서 선택 입력으로 유지한다. DB도 계속 nullable로 둔다(스키마 변경 없음). 값이 입력된 경우에만 형식을 검증한다 — birthDate는 미래 날짜 금지, guardianPhone은 전화번호 형태(숫자/하이픈), guardianName은 trim 후 빈 문자열 금지. 대신 아이 목록에서 이 세 필드 중 하나라도 비어 있으면 "정보 미입력" 배지로 시각적으로 구분한다(isProfileIncomplete 순수 함수).
- Reason: 문의 단계에서 이름만으로 아이를 먼저 등록하고, 이후 상담이 진행되며 생년월일/보호자 정보를 채워 넣는 흐름이 실제 운영에서 발생한다. 이를 필수 입력으로 막으면 운영자가 시스템을 우회해서 수기로 관리하게 되어 도입 취지가 무너진다. 미입력 항목을 감추지 않고 배지로 드러내는 것으로 데이터 완결성에 대한 가시성은 확보한다.
- Consequences: 이후 예약/결제(Phase 5/8) 로직에서 guardianPhone 등이 null일 수 있다는 전제를 계속 유지해야 한다. 미입력 아이만 걸러보는 목록 필터는 이번 범위에 포함하지 않았다 — 운영 중 필요성이 확인되면 별도 기능으로 추가한다.

## ADR-011: 아이 상세 화면의 미구현 섹션은 placeholder-section 공용 컴포넌트로 통일하고 Phase 소유권을 명시한다
- Status: Accepted
- Date: 2026-08-21
- Context: REQUIREMENTS.md 3.4는 아이 상세 화면에 친구관계/형제자매관계/예약 이력/결제 이력/환불 이력/안전 정보 및 동의 현황을 함께 보여주도록 요구하지만, 해당 데이터를 만드는 기능들은 아직 Phase 2 이후에 순차로 구현된다(REQUIREMENTS.md 22장 개발 우선순위). Phase 2에서 각 섹션을 서로 다른 방식으로 비워두면 이후 Phase마다 다른 컴포넌트를 새로 만들거나 기존 구조를 뜯어고치게 된다.
- Decision: Phase 2는 각 섹션을 데이터 조회 로직 없이 공용 컴포넌트 placeholder-section.tsx 로만 렌더링한다. 이 컴포넌트는 title, description(예: "Phase N에서 제공 예정") 정도의 최소 props만 받는 순수 표시용 Server Component로 계약한다. 각 섹션의 실제 데이터 연결과 소유 Phase는 다음과 같이 고정한다.
  - 친구관계 → Phase 7 (관계)
  - 형제/자매관계 → Phase 7 (관계)
  - 예약 이력 → Phase 5 (예약)
  - 결제 이력 → Phase 8 (결제 / 환불)
  - 환불 이력 → Phase 8 (결제 / 환불)
  - 안전 정보 및 동의 현황 → Phase 6 (안전 정보 / 출결)
  해당 Phase 착수 시, 담당 개발자는 상세 페이지에서 대상 placeholder-section 자리를 실제 데이터 조회 컴포넌트로 교체한다.
- Reason: 상세 화면의 레이아웃과 섹션 컨벤션을 Phase 2에서 한 번에 정해두면, 이후 Phase마다 "이 섹션을 어디에 어떻게 넣을지"를 다시 설계하지 않아도 된다.
- Consequences: placeholder-section의 props 계약이 이후 Phase의 실데이터 요구(예: 페이지네이션, 정렬)를 충분히 감당하지 못하면, 해당 Phase에서 상세 페이지 레이아웃 코드를 함께 수정해야 한다. 이 ADR은 매핑만 고정하며 각 Phase의 데이터 조회 방식까지 선결정하지 않는다.

## ADR-012: 아이 목록의 미구현 열은 숫자 0이 아닌 "–"로 통일 표시한다
- Status: Accepted
- Date: 2026-08-21
- Context: Phase 2 QA에서 child-table.tsx가 "친구 수", "형제/자매 수", "누적 예약 횟수" 열을 "0건"으로 고정 렌더링하고 "최근 예약" 열만 "–"로 표시하는 것이 발견되었다. 이 값들은 실제 조회 결과가 아니라 아직 데이터 조회 로직 자체가 없는 미구현 상태이며(친구/형제자매는 Phase 7, 예약 이력/횟수는 Phase 5에서 구현 예정, ADR-011 참조), "0건"이라는 표시는 운영자가 "실제로 예약/친구/형제자매가 0명인 아이"와 "아직 집계 기능이 없어서 값을 알 수 없는 아이"를 구분할 수 없게 만든다.
- Decision: 아이 목록의 친구 수 / 형제자매 수 / 최근 예약 / 누적 예약 횟수 네 열은 각 Phase(친구·형제자매는 Phase 7, 예약 이력·횟수는 Phase 5)가 실제 쿼리를 붙이기 전까지 전부 "–"로 통일해 표시한다. 숫자(0 포함)를 placeholder로 쓰지 않는다. 해당 Phase 착수 시 담당 개발자는 이 열들을 실제 집계/조회 쿼리 결과로 교체하고, 그 시점부터는 실제 0 값이 "0건"으로 정상 표시된다.
- Reason: 목록 화면에서 운영자가 데이터를 신뢰하고 의사결정에 사용하려면, "값이 없음(미구현)"과 "값이 0임(실측)"이 시각적으로 명확히 구분되어야 한다. "–"는 이미 같은 목록의 "최근 예약" 열에서 미구현을 나타내는 표기로 쓰이고 있었으므로, 다른 세 열도 동일한 표기로 통일해 화면 전체의 일관성을 확보한다.
- Consequences: 각 열을 담당하는 Phase(Phase 5, Phase 7)는 착수 시 child-table.tsx의 해당 셀을 실제 쿼리 결과로 교체해야 하며, 이를 누락하면 "–"가 영구적으로 남아 오히려 미구현 상태를 숨기게 되므로 각 Phase의 완료 조건에 이 교체 작업을 포함해야 한다.
