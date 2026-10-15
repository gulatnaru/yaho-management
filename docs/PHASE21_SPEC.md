# Requirement — Phase 21 카카오톡 AI 상담원

- Status: SPEC CONFIRMED (현재 Mock·합성 데이터 개발 범위). 사용자 결정 Q21-01~03 반영. PLAN·BUILD 및 운영 전환 승인 아님.
- 기준: 현재 사용자 요청 → REQUIREMENTS → ADR → ARCHITECTURE → AGENTS → 기존 구현.
- 기준 main: 1fb8c77bdbdf4a8b1c7d6772b2b955c22a124956.
- Branch: feature/phase21-kakao-ai-consultation.

## Problem

보호자의 반복 문의를 카카오톡에서 지원하면서 내부 예약·고객 정보를 노출하지 않아야 한다. 자유 질문을 허용해도 AI가 권한이나 업무 처리 주체가 되어서는 안 된다.

## Current Process

- 착수 시 마지막 등록 Phase는20이며 Phase21 승인 PLAN·AI 상담 구현은 없었다. 이후 사용자 결정으로 이 SPEC의 개발 범위가 확정됐다. PLAN은 별도 승인 대상이다.
- Program에는 이름·설명·연령·가격·메모, ClassSchedule에는 일정·장소·정원·상태·내부/안전 메모가 함께 존재한다. 전체 모델을 AI에 전달할 수 없다.
- Phase18/20 public query는 제한된 select를 쓰고 만석이어도 신청을 받는다. 현재 application availability는 신청 링크 접수 가능 여부이며 좌석 여유 판정으로 재사용할 수 없다.
- 기존 ADMIN authorization과 서버 도메인 구조는 재사용 대상이다. 상담 저장/자동 삭제/AI 공개 허용/카카오 Skill 인증은 아직 없다. 기존 개인정보 파기는 ADMIN 수동 방식이며 새 상담 자동 삭제와 분리해야 한다.
- 기존 main의 .gitignore와 LAST_RUN_REPORT unstaged 변경은 보존하며 이 SPEC은 별도 worktree에서만 작성한다.

## User Story

- 보호자: 야호 프로그램·공개 허용 일정·신청 관련 안내를 자연어로 문의하고, 확실하지 않으면 담당자 연결 안내를 받는다.
- ADMIN: 상담 품질을 점검하고 자동 삭제 실패를 확인·재시도한다. MANAGER/TEACHER는 상담 원문을 볼 수 없다.

## Scope

- 기존 Next.js Modular Monolith 안의 카카오 Skill API 연동과 OpenAI 기반 YAHO 전용 자유질문 상담.
- 공개 허용 Program/ClassSchedule 안내, 서버가 판정한 예약 가능 상태, 승인된 운영정책·준비물·우천 안내.
- 답변할 근거 없음/범위 밖/제한 초과/일시 오류의 안전한 고정 안내와 담당자 연결 수단.
- ADMIN 상담 내역, 원문90일 자동 삭제, 삭제 실패 재시도·관리자 확인, 원문 삭제 후 비식별 통계.
- 외부 요청 인증·입력 검증, Tool allowlist, 호출량/비용 상한, prompt injection 방어, 합성 데이터 검증.

## Out of Scope

- 별도 microservice/MCP 서버, 자유 인터넷/임의 SQL/범용 자율 Agent.
- 고객 개인정보/예약/입금 내역 조회와 예약·결제·환불 등 업무 쓰기.
- Phase20 공개 신청 화면·그룹·입금·반환·재신청 기능 변경, 기존 개인정보 파기 범위 확대.
- 자동 날씨 판단·정책 생성, 건강/법률/일반지식 상담, 담당자에게 실제 배정/전달됐다고 허위 완료 표시.
- 명시 승인 없는 DB migration 적용·Production 배포·PR merge. 기존 보호 설정 우회.

## Business Rules

1. AI는 YAHO 숲체험 관련 승인된 사실만 답한다. 모르는 정보, 공개 대상 미확인, 승인된 안내 부재, 충돌 자료는 추정하지 않고 담당자 안내로 종료한다.
2. AI 공개 대상은 ADMIN이 명시적으로 허용한 프로그램·일정으로 제한하며 기본값은 비공개다. 기존 예약신청 링크 공개 설정과 독립적으로 관리한다(Q21-01 확정). 내부 ID·메모·선생님·보험·안전정보·가격은 공개 정보에 추가하지 않는다.
3. 정원·예약 인원·잔여석 숫자는 모델 입력/Tool 결과/모델 오류·진단에도 전달하지 않고 고객 응답에서도 금지한다. 날짜·시간·연령과 구별하여 검증한다. 실제 예약 읽기 결과는 서버에서 AVAILABLE/UNAVAILABLE/UNKNOWN으로 축소한다.
4. AVAILABLE은 조회 시점의 안내이며 자리 보장·예약 확정이 아니다. UNKNOWN을 AVAILABLE로 바꾸지 않는다. UNAVAILABLE을 이유로 기존 만석 신청 허용이나 ADMIN 최종 확정 정책을 바꾸지 않는다. 정확한 상태 판정과 데이터 신선성은 기존 예약 규칙에 맞춰 PLAN에서 명시한다.
5. LLM에 DB 연결·관리자 권한·기존 고객/보호자 정보가 주어지지 않는다. 서버가 allowlist와 검증된 인자·최소 필드 출력을 강제하고, 범위 밖 tool/인자·도구 결과 속 지시문을 신뢰하지 않는다. 프롬프트만으로 이 경계를 강제했다고 보지 않는다.
6. 입력 길이/크기·요청 빈도·모델 호출 수·토큰·비용·처리시간을 제한한다. 상한 미설정·quota 원자적 확보 실패·오류는 fail closed한다. numeric 상한/모델은 PLAN의 기술·운영 설정으로 구체화하며 API 요금을 임의 정책으로 만들지 않는다.
7. 인증되지 않은 Skill 요청은 상담 데이터 생성과 OpenAI 호출 전에 거부한다. bot ID나 callbackUrl의 존재만으로 인증된 카카오 요청이라 판단하지 않는다. 카카오 관리자센터의 실제 인증 설정 지원 여부를 확인하기 전 실제 접수 경로를 열지 않는다.
8. 카카오 채널·Skill·Callback 상태는 미확인/미준비다. Callback을 필수 전제로 삼지 않고 Mock Skill의 제한 시간 내 응답과 실패 안내를 먼저 검증한다. 실제 연결·인증 지원·Callback 권한은 운영 전환 전 별도 확인 대상이다. Callback URL은 로그·임의 목적지 전송·재사용하지 않는다.
9. 원문은 수집 시점부터90일 범위로 보관한다. 활동으로 오래된 원문 만료를 연장하지 않는다. 만료 원문은 ADMIN·모델 문맥·검색·통계에서 조회되지 않고 자동 삭제 대상이 된다. 삭제 실행 주기·완료 기한과 실패 시 운영 처리는 PLAN에서 검증 가능하게 명시한다.
10. 카카오 원문 식별값은 최소화하고 가명처리하며 OpenAI로 전달하지 않는다. 가명 ID 자체를 완전한 익명정보로 간주하지 않는다. 원문 삭제 후 사용자별 ID·원문·연결키 없이 집계만 유지한다. 백업/외부 제공자 보관은 앱90일 삭제와 구분해 고지·검토한다.
11. 개인정보 처리방침 및 외부 LLM 전송 검토 전에는 Mock·합성 데이터만 이용해 개발·테스트한다(Q21-02 확정). 실제 고객정보·상담 기록의 OpenAI 전송과 운영 환경 연결은 금지한다. 기존 예약 동의를 상담의 수집/이용·외부 전송 근거로 재사용하지 않는다. 운영 전환은 고지·적법 근거·연동 검증 후 별도 승인 게이트이며 시스템이 검토 완료를 선언하거나 설정 변경만으로 우회하지 않는다.
12. 원문·식별값·callback URL·API key·DB credential·raw 외부 응답/오류를 로그에 남기지 않는다. 삭제 재시도와 ADMIN 실패 현황에는 원문 없는 최소 상태/시각만 필요하다.
13. 현재 범위는 Mock Skill·OpenAI mock·합성 지식과 원문만 사용한다. 운영정책·준비물·우천 공식 승인 원문은 미확보이므로 해당 질문은 추정 없이 담당자 안내로 처리한다(Q21-03 확정). Preview DB를 쓰는 검증은 기존 승인 신원·동일 DB·single-run·migration·소유 데이터 cleanup guard를 통과해야 한다. DB 전체 원문 삭제 작업을 shared Preview에서 실행하지 않는다.

## Acceptance Criteria

| ID | 통과 기준 |
|---|---|
| AC21-01 | 인증된 정상 Mock Skill 요청만 처리. 인증 오류·oversize·잘못된 body는 DB 상담 생성/외부 LLM 호출 전 거부 |
| AC21-02 | 승인된 야호 질문에 승인된 공개 근거만으로 답하고 자료 없거나 범위 밖이면 담당자 안내 |
| AC21-03 | ADMIN 명시 허용 대상만 안내하며 기본 비공개. AI 공개와 기존 예약신청 링크 설정은 독립적이고 조회 대상 밖 정보는 LLM/응답/Tool 오류에 없음 |
| AC21-04 | capacity/reservation count/remaining seats가 모델 요청·Tool 결과·고객 응답에 없음. 유출 유도 질문도 숫자 반환 금지 |
| AC21-05 | 예약 상태는 서버 실제 정보에 근거한 허용 상태만. DB 실패/불명확은 UNKNOWN이며 확정·자리 보장으로 표시하지 않음 |
| AC21-06 | tool 이름/인자 변조, prompt injection, SQL·검색·관리자 API 요청을 거부. 예약/결제/환불/고객·동의 행의 변경이0 |
| AC21-07 | 요청/모델/토큰/비용/시간 제한과 동시 quota 확보·중복 요청을 검증. 실패 시 추가 호출과 원문·secret 진단 유출 없음 |
| AC21-08 | ADMIN만 상담 목록/상세·삭제 실패/재시도에 접근. MANAGER/TEACHER의 직접 query/API/action 요청도 서버 거부 |
| AC21-09 | 상담 원문 수집시각+90일 경계, 과거 원문 재사용 방지와 자동 삭제를 검증. 기존 Child/Application/거래 행에는 영향 없음 |
| AC21-10 | 삭제 실패는 원문 없이 확인 가능하고 bounded/idempotent 재시도로 복구. 동시 삭제와 조회에서도 만료 원문 반환 없음 |
| AC21-11 | 삭제 후 통계에 자유 텍스트·카카오 가명 ID·다른 개인정보 및 재연결 가능키가 없음 |
| AC21-12 | 모델 timeout/공급자 실패/근거 없음 시 안전한 고정 안내. 실제 담당자 전달·처리 완료를 허위로 표시하지 않음 |
| AC21-13 | Callback 없이 Mock Skill 정상/제한 시간/실패 흐름 검증. 미준비 카카오 채널/Skill/Callback·인증 지원을 완료로 표시하지 않고 실제 연결 차단 |
| AC21-14 | Mock·합성 데이터만 허용. 검토·별도 운영 전환 승인 전에는 실제 고객정보/상담 기록의 OpenAI 전송·운영 연결 차단. 설정 누락/변조로 해제되지 않음 |
| AC21-15 | 로그/오류/브라우저 응답에 PII·API key·카카오/콜백 capability 없음. 운영 로그 대신 고정 분류만 확인 |
| AC21-16 | Phase20 공개 RSC·신청·입금·반환·친구/재신청 회귀 및 기존 예약·결제·환불·Revenue 검증을 약화하지 않음 |
| AC21-17 | unit/integration·Mock Skill 경로·lint/typecheck/build/diff·QA/Review 결과를 실제 실행 근거와 함께 기록. 미실행을 PASS로 표시하지 않음 |

## Conflicts

| 근거 | 유지/변경 제안 |
|---|---|
| REQUIREMENTS10.6/20, ADR-052/060 | 사용자 결정으로 AI에 한정한 ADMIN 허용 대상과 숫자 없는 예약 상태 공개 예외 확정. 기존 공개 신청의 비공개/만석접수 유지; 설정은 서로 독립 |
| REQUIREMENTS17.2/17.5/17.6, ADR-048~050 | 서버 ADMIN-only 강제 유지. 새 상담 원문/삭제 운영도 MANAGER/TEACHER 차단 |
| REQUIREMENTS20/20-1, ADR-055~058 | 상담 원문·가명 ID·외부 전송은 새로운 개인정보 처리 범위. 기존 동의/보관/파기 변경 또는 재사용하지 않음 |
| REQUIREMENTS24 | 기존 신청 파기 cron 미결정은 그대로. 이번 사용자 요청의 상담90일 자동 삭제만 별도 범위 |
| ADR-030/051/059 | Preview/Production 분리·migration 비자동화·schema gate·수동 E2E 소유 데이터 규칙 유지 |
| ARCHITECTURE1/7/9, AGENTS | Modular Monolith·Zod·Prisma·서버 권한·role 순서 유지. developer subagent는 승인 후 BUILD에서만 사용 |

## Open Questions

없음 — 현재 Mock·합성 데이터 개발 범위의 질문은 사용자 결정으로 해소됐다. 미준비 외부 연동/법적 검토는 운영 전환 차단 조건으로 남기며 구현 Open Question으로 혼동하지 않는다.

### 확정 결정
- Q21-01: ADMIN 명시 허용 프로그램·일정만; 기본 비공개; 예약신청 링크 설정과 독립; 정원·예약수·잔여석 숫자 비공개.
- Q21-02: 검토 전 Mock·합성 데이터만. 실제 고객정보/상담 기록 OpenAI 전송·운영 연결 금지; 운영 전환 별도 승인.
- Q21-03: 카카오 채널·Skill·Callback 미확인/미준비. 승인된 운영정책·준비물·우천 원문 미확보. 근거 없으면 담당자 안내; Callback 비필수.

### 운영 전환 차단 조건
- 개인정보 처리방침·수집/이용 근거·외부 LLM 처리 검토 및 승인.
- 카카오 계정/채널/Skill의 실제 설정·요청 인증 방식 확인. Callback을 채택할 경우 실제 사용 권한과 계약 확인.
- 안내에 사용할 공식 원문 승인. 미확보 주제는 운영 전환 후에도 담당자 안내를 유지.
- 별도 명시 승인된 DB migration 적용·Production 배포·merge 및 운영 전환. PLAN 승인은 이 승인을 대신하지 않는다.

## Priority

Now — Mock·합성 데이터 범위 SPEC 확정, PLAN 작성 가능. 상세 설계 승인 전 구현·migration 파일·테스트 코드·배포·PR을 만들지 않는다.

## 외부 연동 검토 근거

- [카카오 Skill 가이드](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/make_skill): HTTP POST JSON 스킬 계약. 예제의 원문 body 로그는 프로젝트 PII 금지 규칙에 따라 재사용하지 않는다.
- [현재 Callback 가이드](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/ai_chatbot_callback_guide): 5초 응답 SLA, 현재 직접 조회한 본문상 callback URL5분/1회. 오래된 검색 요약의1분/권한 문구로 실제 봇 설정을 단정하지 않는다. 현재 본문은 블록 Callback 설정을 설명하며 해당 계정의 설정 가능 여부는 아직 확인하지 못했다.
- [OpenAI Data controls](https://developers.openai.com/api/docs/guides/your-data): store:false는 Response 상태 저장을 줄이는 통제이며 모든 제공자 보관 부재를 보장하지 않는다. 기본 abuse monitoring 로그에 고객 내용이 포함될 수 있고 통상 최대30일 보관된다. 별도 ZDR/MAM 승인 여부를 추정하지 않는다. 앱90일 원문 삭제와 구분한다.
- [개인정보위 국외이전 안내](https://pipc.go.kr/np/default/page.do?mCode=D060040000): 국외 처리위탁/보관도 검토 대상이며 적용 근거·고지·안전조치를 확인해야 한다. 이 문서는 YAHO에 어떤 근거가 적용되는지 법적 결론이나 승인된 동의 문구를 새로 정하지 않는다.
