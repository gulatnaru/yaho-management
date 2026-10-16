# Requirement — 카카오톡 AI 상담원 실연동 후속 SPEC

- Date: 2026-10-15
- Status: SPEC 확정 / 사용자 조건부 PLAN·합성 BUILD 승인 반영 — QLIVE-01~02 사용자 결정 반영. 조건부 PLAN 및 합성 전용 BUILD/QA/Review 승인. 실호출·DB 적용·운영 전환 승인은 아니다.
- 기준: Phase 21 Mock PR #53, HEAD `117151772552b16b6e81e3bbba23bb50e0826f0e`, AC21-01~17, ADR-061.
- 위치: 기존 Phase 21의 후속 제안이다. Mock 완료 범위에 실연동을 편입하거나 다음 Phase를 착수한 것으로 표시하지 않는다. 후속 Phase 번호는 PR #53 처리 후 실제 REQUIREMENTS의 다음 사용 가능한 번호로 정한다.
- 현재 승인된 작업: 별도 feature/phase21-ai-service의 승인 PLAN 코드·신규 additive migration 파일·합성 unit/local 검증·독립 QA/Review. 실제 외부 API 호출·DB 적용/접속·Preview E2E·배포·merge 승인은 포함하지 않는다.

## Problem

Phase 21은 합성 요청에 대한 공개 통제·동시성·암호화·90일 만료와 정리를 검증했다. 실제 자연어 질문·카카오 요청 인증·OpenAI 사용료·운영 삭제 작업은 검증하지 않았다. Mock을 실제 서비스로 잘못 활성화하지 않으면서 후속 개발의 요구사항과 승인 조건을 분리해야 한다.

## Current Process

- PR #53은 OPEN/Draft이고 자동 merge는 설정되어 있지 않다. quality CI는 SUCCESS이나 Production migration job은 사람 Environment 승인 대기이며 실행 단계가 없다. 이 상태를 schema gate PASS로 해석하지 않는다.
- 실제 `/api/kakao/skill`과 `/api/cron/ai-consultations-retention`은 503 고정 응답으로 비활성화되어 있다. 실제 OpenAI Provider는 없다.
- Mock은 승인된 Preview·배포 SHA·DB 신원·실행 lease·소유 manifest·요청 서명을 요구하고 Production에서는 차단한다. 합성 플래그만으로 접수하지 않는다.
- 공개 설정·상담·quota·삭제 작업은 실행별 `runId`에 종속된다. DB `AiConsultation.origin`은 `SYNTHETIC`만 허용하고 비용은 실제 화폐 원장이 아니다. 테스트용 scope와 zero-cost quota를 실서비스에 그대로 사용할 수 없다.
- 기존 Preview 적용 migration은 변경하지 않는다. 후속 독립 schema의 신규 additive migration 파일 작성은 승인됐으며 실제 DB 적용/접속은 별도 승인 전 금지한다.
- 기존 Phase 20 신청·예약·Payment/Refund/Revenue, 고객 동의·파기 정책은 그대로 유지한다. 과거 1,151개 unit 및 Preview 검증은 Mock 검증 근거이며 실서비스 검증 PASS가 아니다.

## User Story

- 보호자로서, 야호의 공식 안내와 공개 허용된 프로그램·일정에 관해 자연스럽게 질문하고 근거가 있는 안내 또는 담당자 상담 방법을 받고 싶다.
- ADMIN으로서, AI 공개 자료·이용 비용·서비스 상태·삭제 장애를 확인하고, 승인 범위 밖 정보와 월 예산 초과 호출을 차단하고 싶다.
- 운영자로서, 상담 개인정보의 외부 전송·보관·만료·삭제·복구가 승인된 정책과 일치하는지 확인하고 단계별 승인 후 실서비스를 열고 싶다.

## Scope

### 후속 개발에서 충족할 기능

1. 실제 카카오 Skill 요청 인증·입력 검증·응답 변환과 안전한 담당자 안내.
2. OpenAI Responses API 기반 경량 모델 평가 및 Provider 구현. 다른 Provider로 교체할 수 있는 계약과 동일한 보안·비용 통제.
3. 자연어 의도 분석과 승인된 읽기 전용 Tool 선택, 서버의 인자·조회 범위·근거·최종 응답 검증.
4. ADMIN 승인 프로그램·ClassSchedule·안내 원문만 공개. 숫자 없는 예약 가능 상태.
5. 전체 4초 처리 예산과 timeout·취소·늦은 완료 처리. Callback은 실제 기능 확인 후 필요성과 별도 승인 조건을 검토한다.
6. 월 KRW 10,000 실제 청구액 목표 상한, 동시 예상 비용 예약·중복 요청·사용량 정산·불확실한 비용 복구·월 경계 처리.
7. 상담 원문의 분리된 키·버전 암호화와 90일 만료 조회 차단·자동 삭제·장애 재시도·ADMIN 확인·비식별 집계.
8. ADMIN 공개 설정·운영 중지·비용/호출량/오류/삭제 backlog 모니터링.
9. Mock → 승인된 Preview 실연동 → 승인된 Production 전환의 환경·데이터·credential·schema·배포·활성화 경계.

### 현재 승인된 합성 BUILD 작업

확정된 사용자 결정, 수용 기준, 기존 규칙 유지·변경 근거와 미결정 정책을 기록한다. 현재 정책 Open Questions는 해소됐고 조건부 PLAN과 합성 BUILD가 승인됐다. 승인 설계만 구현하며 실호출·운영 전환은 별도 승인 gate를 유지한다.

## Out of Scope

- PR #53 변경 commit/push·Draft 해제·merge·Production Schema Gate 승인.
- 이번 작업에서 migration 적용, DB 접속, 환경변수 실제 설정, 배포, Kakao/OpenAI 실호출 및 고객 데이터 처리.
- 기존 Phase 20 기능 변경, 고객 계정/전화번호 조회/개인정보 검색, 예약 생성·변경·취소, Payment/Refund 처리.
- 임의 SQL, 자유 인터넷 검색, 관리자 API Tool, 외부 MCP·microservice, 모델 자율 권한 확대.
- Gemini·Claude 실제 구현/호출 및 자동 Provider failover 활성화. 교체 가능한 인터페이스 설계와 별도 평가·승인 조건만 포함한다.
- 통화·이미지·파일 상담, 고객별 장기 기억, 원문 재전송을 통한 다중 대화 기억, 자동 SMS/카카오 알림, 운영 원문으로 학습/평가 데이터 구축.
- 기존 고객·신청·거래 보관기간 변경 또는 전체 DB 정리.

## Business Rules

### 확정된 비용·Provider 원칙

1. LLM 월 예산은 부가세·환율·해외 결제·카드 수수료 등을 포함한 실제 청구액 기준 KRW 10,000의 목표 지출 상한이다(QLIVE-01 확정). 예상 환율과 세금·수수료에 보수적 여유를 적용해 신규 호출을 차단한다. 실제 청구액이 사전 계산과 다를 수 있으므로 절대 초과하지 않는다고 보장하지 않는다. 예산 부족·소진 시 새 호출을 차단하고 담당자 안내를 반환한다. ADMIN 설정/Provider 교체로 목표 금액을 조용히 올리지 않는다.
2. 최초 평가 대상은 OpenAI 경량 모델이다. 한국어 품질·근거 일치·제한 시간·usage 취득·단가를 평가한 후 모델을 선택한다. Provider가 바뀌어도 공개·개인정보·권한·비용·시간 경계가 완화되지 않는다.
3. 승인 PLAN의 월 기준은 KST 매월1일00:00이며 과거월의 비용·미확정 hold를 보존한다. 호출승인8000원은 분리DB의 Preview1000/Production7000 hardcap과외부청구대조로관리한다. ADMIN확인환율72시간, 환율10%·세금10%·수수료5% 초기예비율과원단위올림을적용한다. 실제청구조건/목표10000원의절대보장과는구분한다.
4. 동시 요청은 호출 전에 제한된 토큰·가격과 보수적 계수로 산정한 예상 최대 비용을 원자적으로 확보한다. 이미 확정한 사용액·처리 중 예약액·미확정 사용액을 누락해 한도를 재사용하지 않는다. 정확한 계산식과 화폐 정밀도는 PLAN에서 정한다.
5. 동일 요청 재전송·처리 중 요청·동시 완료로 모델 호출·청구 정산·통계를 중복 실행하지 않는다. 같은 식별자의 다른 내용은 거부한다. 카카오가 보장하는 요청 식별자/재시도 계약은 실제 계정 확인 전 추정하지 않는다.
6. 호출 전 미사용이 확실한 예약만 반환 가능하다. 전송 후 timeout/중단/usage 미확정은 비용 0으로 처리하거나 무조건 환급하지 않는다. 늦은 응답은 새로운 시도 결과를 덮어쓰지 않는다. 불확실한 정산과 재시도는 ADMIN 확인 대상으로 추적한다.
7. 월 갱신·Provider 교체·키 교체·재시도는 기존 비용을 초기화하는 방법이 아니다. 기존 월의 미확정 비용과 청구 보정은 보존하며 보수적인 사전 계산 근거가 없거나 가격·환율·usage가 불명확하면 새 호출을 닫는다. 뒤늦은 실제 청구 차이는 누락하지 않고 정산·운영 확인 대상으로 남긴다.
8. AI 사용료는 운영 비용이며 기존 Payment/PaymentItem/Refund/Revenue의 고객 결제 의미와 집계에 섞지 않는다.

### 인증·조회·응답 경계

9. Skill 요청은 서버에서 인증·환경·허용 봇/채널 범위를 확인한 후 검증한다. 공개 payload의 bot ID·user ID·callback URL만으로 신뢰하지 않는다. 인증 실패는 상담 저장·도구 실행·유료 호출 전에 거부한다.
10. 발화·payload 크기, 사용자/전체 호출 빈도, 처리 중 동시 요청, 모델 호출·입출력 토큰과 실행 시간을 제한한다. 정확한 기술 상한은 PLAN에서 검증 가능하게 정한다.
11. 모델은 DB·credential·운영자 권한을 갖지 않는다. 서버의 허용된 읽기 Tool만 사용할 수 있다. 알 수 없는 Tool·인자·데이터 범위를 거부하고 자유 SQL·검색·관리자 API·고객 조회·예약/금융 쓰기를 허용하지 않는다.
12. Program과 ClassSchedule의 AI 공개는 ADMIN이 명시 허용하고 기본 비공개다. 기존 예약신청 링크 공개와 독립이며 공개를 철회한 자료를 늦은 응답·캐시·모델 결과로 다시 공개하지 않는다.
13. 운영정책·준비물·우천 안내는 ADMIN 승인된 공식 원문만 사용한다. 원문이 없거나 충돌·만료·승인 철회로 근거가 없으면 추측하지 않고 담당자 안내를 반환한다.
14. 서버에서 예약 상태를 판정하고 `AVAILABLE` / `UNAVAILABLE` / `UNKNOWN`만 공개한다. 정원·예약 인원·잔여석 숫자는 모델 입력·Tool 결과·고객 출력·오류에 포함하지 않는다. 허용된 날짜/시간 숫자와 좌석 숫자를 구분해 검증하며 모든 숫자 삭제를 안전성 검증으로 대신하지 않는다.
15. YAHO 범위 밖 질문·인젝션·권한 변경·비밀 공개·예약 보장 요구는 거부 또는 담당자 안내로 처리한다. 사용자 발화·안내 문서·Tool 결과 속 지시문이 시스템 권한을 변경하지 못한다. 모델의 분류나 자유 문장을 신뢰해 그대로 반환하지 않고 서버가 근거와 응답을 검증한다.
16. 전체 처리 제한은 4초다. 단계별 timeout, DB/lock 대기, 외부 요청 중단, 정산·안내 반환 시간을 PLAN에 배정한다. 네트워크/모델 지연 시 deadline 내 안전한 고정 안내로 종료하고, 중단을 실제 비용 취소로 간주하지 않는다.
17. Callback은 필수 전제가 아니다. 실제 봇 권한·TTL·1회 사용 계약·목적지 검증·중복 전송·장애 복구와 보안이 확인되고 별도 채택 승인을 받은 경우에만 사용한다. HTTP 응답 후 비보장 background 실행만으로 완료를 약속하지 않는다.
18. 담당자 안내는 승인된 상담 경로를 안내하는 의미다. 실제 담당자 전달·예약 확정·처리 완료를 하지 않았는데 완료되었다고 말하지 않는다. 연락 경로가 미설정이면 정보나 URL을 만들어내지 않는다.

### 상담 개인정보·삭제

19. 실제 상담 원문은 암호화하여 수집시각부터 90일만 보관하고 활동·재시도·키 교체로 기간을 연장하지 않는다. 만료 이후 ADMIN 조회·모델 문맥·검색·캐시 재응답에 원문을 사용하지 않는다. 자동 물리 삭제와 조회 차단을 각각 검증한다.
20. 암호화 키, 가명화/HMAC 키 및 외부 요청 인증 secret을 분리하고 버전을 관리한다. 복호화 실패·키 누락·변조·알 수 없는 버전은 안전하게 거부하며 평문 fallback·원문 오류 로그를 만들지 않는다.
21. 카카오 사용자 식별값을 최소화·가명처리하고 모델에 전달하지 않는다. 기존 Child/guardian 관계나 전화번호에 매칭하지 않는다. 가명 ID를 익명정보로 취급하지 않는다. 실데이터의 수집·보관·외부 전송 최종 허용 범위는 법적 문서 확보와 별도 운영 승인 전 확정하지 않는다. QLIVE-02는 승인 문서 미확보·합성 전용 유지로 해소됐으며 실데이터 허용으로 해석하지 않는다.
22. 기존 예약신청 동의를 상담 원문 수집·외부 LLM 전송의 근거로 재사용하지 않는다. 개인정보 고지·처리 근거·국외 처리·외부 제공자의 실제 보관 정책·백업을 검토하고 별도 승인 전 실제 데이터를 처리하지 않는다. 앱의 암호화·90일 삭제만으로 외부 보관이 없어졌다고 주장하지 않는다.
23. 자동 삭제는 인증된 실행만 허용하고 실행 범위·작업량·동시성·재시도 횟수·장애 기록을 제한한다. 삭제 실패는 ADMIN이 원문 없이 확인·재시도할 수 있고 실패해도 만료 원문은 계속 조회 금지다. 물리 삭제 주기·최대 지연·알림/운영 대응 및 복구 후 재삭제는 합성 검증으로만 PLAN에서 검증 가능하게 제시한다. 백업/물리 삭제 지연의 법적 적합성은 별도 운영 승인 조건이다.
24. 원문 삭제 후에는 원문·자유 텍스트·사용자 ID/가명 ID·request/callback/consultation 연결키 없는 비식별 집계만 유지한다. 비용 정산에 필요한 최소 비원문 정보는 재식별 여부와 필요한 기간은 운영 전 개인정보 검토 gate에서 확인하며 임의의 실데이터 보존 허용 범위를 만들지 않는다.
25. 로그·APM·에러·URL·테스트 아티팩트에 발화/답변 원문·카카오 ID·callback capability·API key·credential을 출력하지 않는다. ADMIN 상세도 만료·권한을 서버에서 확인하고 공개 HTML/RSC·다른 역할에 원문을 싣지 않는다.

### 운영·환경·승인

26. 공개 설정·원문 관리·상담 조회·비용 상태·삭제 운영은 ADMIN만 사용할 수 있고 MANAGER/TEACHER의 직접 API/Action 호출도 차단한다. secret은 환경변수에만 두며 UI나 DB 일반 설정으로 평문 노출하지 않는다.
27. Mock은 계속 Production에서 무조건 차단한다. 실연동은 Mock guard·합성 제약·run 소유권을 제거해서 활성화하지 않는다. 후속 PLAN에서 실제 서비스와 합성 검증의 범위 분리 및 신규 migration 필요성을 명시한다.
28. 일반 Preview 검증은 승인된 URL·동일 승인 Preview DB·배포 신원·migration·단일 실행 잠금·run별 합성 데이터·소유 데이터 cleanup을 유지한다(ADR-059). 실제 고객 데이터를 테스트에 사용하지 않는다. 정리 과정에서 기존 데이터·다른 실행·Phase 20 행을 삭제하지 않는다.
29. Preview OpenAI 실호출도 유료 외부 요청이므로 합성 데이터, 비용 통제, credential 출처와 별도 실행 승인을 요구한다. 카카오 staff 테스트도 실제 계정 식별값을 다룰 수 있으므로 단순히 발화가 합성이라는 이유로 법적 검토를 생략하지 않는다.
30. 개인정보 승인, Kakao 인증·계약 확인, 실호출 평가, DB migration 적용, Production schema gate, merge, 배포 및 서비스 활성화 승인은 각각 기록한다. 설계 승인·CI·Vercel READY는 다른 승인을 대신하지 않는다. 이번 요청은 어느 실행 승인도 부여하지 않는다.
31. migration은 Prisma 절차와 expand 호환성을 따르며 이미 적용된 Mock migration을 수정하지 않는다. 전체 reset/truncate/db push·Production seed·수동 schema 수정·보호설정 우회를 금지한다. 적용·실패 복구 방안은 후속 PLAN/Review에서 별도 확인한다.

## Acceptance Criteria

새 접두사 `ACLIVE`는 후속 범위 식별자이며 기존 AC21-01~17을 변경하지 않는다. 아래 기준은 PLAN 승인 후 합성 데이터로 구현·검증한다. 실제 연동/데이터/운영 검증은 별도 실행 승인 전 미실행으로 구분한다.

| ID | 통과 기준 |
|---|---|
| ACLIVE-01 | 잘못된 인증·환경·봇/채널·payload·길이 제한 요청은 저장·Tool·유료 호출 전에 거부되고 인증 값/원문이 출력되지 않음 |
| ACLIVE-02 | 한국어 정상 발화를 승인된 의도로 해석하며 YAHO 밖 질문·근거 없음·주입·모델 오류는 안전한 담당자 안내 |
| ACLIVE-03 | Program/Class 기본 비공개 및 ADMIN opt-in, 원문 승인/철회가 서버 조회와 최종 응답에서 강제. Phase 20 공개 링크 설정과 독립 |
| ACLIVE-04 | 좌석 관련 숫자·내부 ID·운영 메모·타 고객 정보가 모델 입력/도구 결과/출력/HTML/RSC/오류에 없음. 예약 상태만 공개하며 보장하지 않음 |
| ACLIVE-05 | Tool/인자 변조·SQL·검색·관리자 API·고객 개인정보·예약/결제/환불 쓰기 요청을 차단. 해당 기존 도메인 쓰기 0 |
| ACLIVE-06 | OpenAI 구현과 대체 Provider 계약의 테스트 더블이 동일한 Tool·deadline·usage·응답 검증 경계를 통과. 실제 Provider 교체는 자동 활성화되지 않음 |
| ACLIVE-07 | 월 KRW 10,000 실제 청구액 목표(세금/수수료 포함)와 보수적 예상 비용·환율/가격 버전·정산 기준을 적용. 절대 청구 상한 보장으로 표시하지 않음. 상한 부족·가격/환율 미설정·불확실 비용은 새 호출 차단 |
| ACLIVE-08 | 한도 직전 동시 요청에서 원자적 비용 확보로 예상 예산을 초과한 호출 승인 0. 처리 중 예약·불확실 사용액 포함. ADMIN/Provider 변경으로 비용 초기화 불가 |
| ACLIVE-09 | 동일 요청 동시 처리·재전송·내용 변경·실패/timeout에서 호출·정산·통계 중복 없음. 안전하지 않은 자동 재호출 없음 |
| ACLIVE-10 | 전송 전 확실한 미사용만 반환. 전송 후 불확실 비용·늦은 usage·중복 완료·월 경계에서도 금액 보존과 1회 정산, 복구 대상 확인 |
| ACLIVE-11 | 입력/호출량/토큰/동시성 제한과 전체 4초 timeout·중단이 적용되며 늦은 응답이 Tool/저장/새 시도를 오염시키지 않음 |
| ACLIVE-12 | Kakao 응답 형식과 안전한 fallback 검증. Callback 미지원 시 동기 응답 경로 유지; 채택 시 인증·목적지·TTL·1회·재전송·장애 검증 후에만 활성화 |
| ACLIVE-13 | 원문 암호화·분리 키/버전·변조 거부·복호화 실패 거부. Kakao ID가 모델·로그로 나가지 않고 승인된 수집/전송 범위만 적용 |
| ACLIVE-14 | 수집+90일 전/정확히/이후·조회/삭제 경합에서 만료 원문 반환 0. 삭제 실패·키 교체·재시도로 TTL 연장 없음 |
| ACLIVE-15 | 실제 scheduler/worker의 인증·제한 batch·재시도·실패 확인·중복 실행·복구 후 재삭제를 검증. fake-clock Mock 성공을 운영 삭제 PASS로 대신하지 않음 |
| ACLIVE-16 | 삭제 후 원문/사용자·요청 연결키 없는 비식별 집계만 유지. 승인되지 않은 백업/제공자 보관을 제거됐다고 주장하지 않음 |
| ACLIVE-17 | ADMIN만 설정/원문/예산·장애·삭제 운영 가능. MANAGER/TEACHER 직접 호출 및 공개 RSC 유출 차단 |
| ACLIVE-18 | Mock Production 차단과 Preview safety guard 유지. 단계별 별도 승인 없이는 실제 provider/카카오/customer/Production 활성화 불가 |
| ACLIVE-19 | 새 schema 필요성·기존 데이터 호환·이전 앱 호환·실패 복구를 검토하고 기존 적용 migration·Phase 20 정책/데이터를 보존 |
| ACLIVE-20 | unit/통합/Preview E2E·비용/월경계/경합·보안·lint/typecheck/build·독립 QA/Review를 근거로 기록. 미승인 실실행은 NOT RUN, 미완료 운영 gate는 미완료로 표시 |

## Conflicts

| Source of Truth 근거 | 유지/변경 및 이유 |
|---|---|
| REQUIREMENTS22 Phase 21 / PHASE21_SPEC AC21-01~17 / ADR-061 | 유지. 이번 사용자 요청은 실연동 후속 문서만 승인했으며 Mock 전용 런타임·Production 금지·기존 AC를 supersede하지 않음. 실서비스 확장은 별도 설계/실행 승인 후 신규 범위로 추가 |
| ADR-061 Development Gate/Retention 및 REQUIREMENTS20/20-1, ADR-055~058 | 유지. 상담90일·가명화·법적 검토·운영 전환 분리. 기존 Child/Application 동의·5년/수동 파기 정책과 혼합하지 않음. QLIVE-02는 합성 전용 유지로 해소됐고 법적 문서/운영 승인은 별도 차단 조건 |
| REQUIREMENTS10.6/20 및 ADR-052/060/061 | 유지. 기존 공개 신청 정보 비공개와 만석 접수는 변경 없음. AI 경로만 ADMIN 승인 자료·숫자 없는 예약 상태 예외 유지 |
| REQUIREMENTS17.2/17.5/17.6, ADR-048~050 | 유지. ADMIN-only·즉시 서버 권한 확인. 관리자 UI 숨김만으로 구현하지 않음 |
| REQUIREMENTS22 Phase 8/9 및 ADR-035/039/040 | 유지. LLM 운영 비용은 고객 Payment/Refund/Revenue 의미를 변경하지 않음 |
| ADR-030/051/059 및 REQUIREMENTS24 테스트 인프라 | 유지. Preview 공유 DB·migration 비자동화·사람 schema gate·수동 Preview-safe E2E·CI 자동 E2E 금지 |
| ARCHITECTURE1/7/9, AGENTS 및 yaho-spec/plan 역할 | 유지. Modular Monolith·Prisma·Zod·서버 통제. developer BUILD가승인설계/코드를작성; PLAN/QA/Review는읽기전용, 미해결질문은없음 |
| 이번 사용자 결정 → ADR-062 | 후속 요건 확정. 월10,000원은 세금/수수료 포함 실제 청구액 목표이며 보수적 추정·차단과 절대 보장 없음으로 명확화. 개인정보 문서 미확보·합성 전용·실데이터 외부 전송 금지 확정. KST 갱신은 PLAN 기본 검토안. 기존 Accepted ADR 수정 없음 |

## Open Questions

없음 — 2026-10-15 사용자가 QLIVE-01~02를 다음과 같이 결정했다. 이는 합성 기반 개발·검증 및 실연동 설계를 진행할 수 있다는 의미이며 실제 고객 처리나 실호출 승인이 아니다.

### 확정 결정 및 이력

- QLIVE-01 해소: 월10,000원은 부가세·환율·해외 결제·카드 수수료 등을 포함한 실제 청구액 목표 상한이다. 예상 환율·세금·수수료에 보수적 여유를 적용해 신규 호출을 차단한다. 실제 청구액의 절대 초과 방지를 보장하지 않는다. 구체적인 계수·정산·KST 월 갱신은 PLAN 승인 대상이다.
- QLIVE-02 해소: 개인정보 처리방침·외부 AI 전송·국외 이전·보관/삭제·백업 승인 문서는 미확보다. 검토 완료 전 실제 고객 데이터·카카오 사용자 식별정보·실제 상담내용의 외부 LLM 전송을 금지한다. 합성 데이터 기반 개발·검증만 허용한다. 기존 ADR-061의 운영 연결 차단도 유지한다.

### 별도 준비·승인 gate (미완료; SPEC Open Question과 구분)

- 실서비스 개인정보의 수집·보관·외부 전송·국외 처리·백업 삭제/복구·비원문 정산 정보 보존에 관한 승인 문서와 운영 전환 승인을 확보한다. 현재 미확보 상태를 승인 완료로 재해석하지 않는다.
- 카카오 채널/Skill 헤더 인증·재시도 식별자·Callback 권한/TTL/1회 계약, 공식 안내 원문, OpenAI 계정 접근·실제 품질/지연, scheduler 권한/과금제·키·모니터링·백업 복구 증거를 별도 확인한다.
- 이번 요청의 실제 외부 API 호출·DB 변경/migration·배포·Production schema gate 승인·PR53 merge 금지는 계속 유효하다. PLAN 승인도 이 실행 승인을 대신하지 않는다.

## Priority

Now — SPEC 정책 확정 및 yaho-plan 설계안 보고. Next — 사용자 PLAN 승인 후 developer BUILD를 합성 전용 범위에서 별도 착수. Later — 비운영 DB/Preview 실호출·카카오·Production 전환은 각 실행 승인과 법적/운영 gate 충족 후 진행한다.

## 향후 비용 참고 — 정책이나 실측이 아님

2026-10-15 직접 확인한 공식 문서상 `gpt-6-luna`는 경량 평가 후보이며 function calling과 structured outputs를 지원한다. 아직 최종 모델 선정·계정 접근·한국어 품질·4초 응답 성능을 승인/검증하지 않았다. [모델 문서](https://developers.openai.com/api/docs/models/gpt-6-luna)

Standard/short-context 텍스트 단가 입력 USD0.10, 출력 USD0.50 / 100만 토큰을 사용한 **호출당 입력1,500·출력300 토큰, 실제 호출1회**의 단순 예시:

| 호출 수 | 예상 API 사용료 USD | 원화 환산식 |
|---|---:|---:|
| 1,000 | 0.30 | 0.30 × 승인 환율 R |
| 10,000 | 3.00 | 3.00 × 승인 환율 R |

이는 토큰 가정이며 월 처리량 약속이 아니다. 실측 토큰·유료 재시도·캐시 쓰기·추론/추가 호출·tier/region·세금·수수료·FX 차이와 Vercel/Supabase 비용은 포함하지 않았다. API 원화액만의 이론적 건수는 `10,000 / (0.00030 × R)`이나 실제 운영 한도는 최대 비용 선예약·미확정 비용과 승인된 비용 범위 때문에 작아진다. 현재 환율이나 실제 세금/수수료를 단정하지 않는다. 확정된 실제 청구액 목표에 필요한 보수적 계수·미확정 비용·청구 차이는 PLAN 제안에 포함한다. [가격 문서](https://developers.openai.com/api/docs/pricing)

## 공식 문서 및 준비사항 (2026-10-15 확인)

- [카카오 Skill 설정](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/make_skill): 실서비스/테스트 URL과 헤더를 각각 설정할 수 있다. 계정의 실제 지원·secret 전달·요청 계약은 별도 확인한다.
- [카카오 Callback](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/ai_chatbot_callback_guide): Skill timeout5초; 직접 본 본문은 Callback5분/1회를 안내하지만 오류 표에1분 문구도 남아 있다. 실제 계정 검증 전 TTL을 단정하거나 필수 설계로 삼지 않는다. 앱4초는 여유를 위한 요구이며 실제 SLA PASS가 아니다.
- [OpenAI 데이터 통제](https://developers.openai.com/api/docs/guides/your-data): `store:false`만으로 모든 제공자 보관이 없어지지 않는다. abuse-monitoring 보관과 별도 ZDR 자격/예외를 검토해야 한다. 앱90일 정책과 구분한다.
- 사용자가 준비할 항목: 운영 전 개인정보/외부 처리 승인 문서(현재 미확보), Kakao 채널/봇 관리자 권한·허용 상담 경로·공식 안내 승인, 별도 Preview/Production OpenAI 프로젝트 및 예산 책임자, scheduler/키/백업 운영 담당. secret 원문은 문서·대화·Git에 넣지 않는다.
- 환경변수 이름·Provider 계약·DB 모델·migration·단계별 timeout·환율/정산 알고리즘·테스트 파일 배치는 PLAN이 정할 기술 항목이다. 이번 SPEC에서 구현 설계로 확정하지 않는다.

## 작업 기록

- PR #53 HEAD/Draft/OPEN·quality/Vercel SUCCESS·production-migrate WAITING을 읽기 전용 확인했다. 승인·재실행·merge·push는 하지 않았다.
- REQUIREMENTS 확정 결정과24장 미결정 항목, ADR-062의 확정 정책을 이 작업과 연결한다. 기존 ADR-061/Mock SPEC/PLAN·코드·migration·보호된 unstaged 보고서는 변경하지 않는다.
- 후속 SPEC 확정 문서는 기존 feature worktree에 미커밋 상태로 저장한다. PR #53의 원격 변경사항과 tested HEAD는 유지한다.
- 이번에 기능 테스트·build·DB 통합·Preview E2E는 실행하지 않았다. 문서 diff/보존 검증만 수행하며 과거 Mock PASS를 새 실연동 결과로 보고하지 않는다.

## 2026-10-15 조건부 BUILD 승인
독립 feature/phase21-ai-service에서 승인 PLAN·합성 local BUILD/QA/Review만 진행한다. PR #53 Draft/기존 Mock·migration 보존, 하루1회 삭제 기본안, 환경별1000/7000원 hardcap과외부청구대조. 실제 API·고객데이터·모든DB적용/접속·Preview E2E·Production·merge는미승인. 상세 승인경계는 AI_CONSULTATION_LIVE_PLAN.md를 따른다. 앞선 문서작업전용 문구는 당시checkpoint이며현재승인범위는이절을우선한다.
