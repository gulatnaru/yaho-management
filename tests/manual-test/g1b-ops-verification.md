# G1-B 격리 PG·Playwright 검증 명세 — 오케스트레이터 실행 대기

실행하지 않았음. 반드시 일회용 로컬 격리 DB와 합성 이메일·계정만 사용한다. 실키·실발송 금지. 먼저 migration을 격리 DB에 적용하고 기존 P3/P4/P5/P7 및 G1-A STAFF 회귀를 별도로 실행한다. 앱과 테스트 프로세스는 동일한 합성 승인자 ID를 사용한다. 실제 운영 설정에 변수를 추가하지 않는다. 격리 fake는 비-Vercel, NODE_ENV test/development, DATABASE_URL과 DIRECT_URL 모두 localhost 또는 127.0.0.1:55432/yaho_e2e 및 yaho_e2e 사용자 조건이 모두 필요하다.

## PG 시드와 단언

- 초기 조건: 완료 표식과 SUPER_ADMIN 0건; 활성 ADMIN 1명(합성 ID), 별도 비활성 STAFF 승인 대상. ops 승인자·활성화와 LEGACY_ADMIN을 테스트 프로세스에만 설정한다.
- A → B → C: A에서 STAFF 비활성/password null과 대면 시각·승인자를 확인, B에서 bcrypt 해시만 남고 role/isActive/authVersion 미변경, C에서 SUPER_ADMIN/활성/authVersion 정확히 +1/mustChangePassword true와 approval·acceptance 소비, CREATED 감사 및 단일 완료 표식이 함께 커밋됨을 확인한다.
- 동시 C: 장벽으로 두 트랜잭션을 동시에 시작해 정확히 1건 성공, 나머지 실패 및 추가 감사·표식·계정 변경이 없음을 확인한다.
- 장애 주입: C 감사 또는 완료 표식 INSERT 실패를 격리 DB에서 유발하고 C의 모든 변경이 롤백되고 앞선 A/B는 유지됨을 확인한다. PENDING attempt INSERT 실패 시 수락 생성과 기존 토큰 철회도 롤백되는지 확인한다.
- 표식이 있고 SUPER_ADMIN 행이 없더라도 모든 쓰기와 두 ops 화면이 차단되는지 확인한다. SUPER_ADMIN 행만 있을 때도 거부한다.
- P3 SUPER_ADMIN 초대 입력 및 기존 합성 초대의 SUPER_ADMIN 수락 거부, P5 구 authVersion 세션 무효화, G1-A STAFF 차단을 기존 테스트로 확인한다.
- 재발급은 새로운 토큰 해시·새 acceptance·새 unique attempt를 만들고 기존 미수락은 철회되는지 확인한다. 중복 attempt INSERT는 unique 위반이어야 하며 acceptance 증거를 삭제해도 별도 보존된 attempt의 FK 방해가 없음을 확인한다.
- 합성 토큰 원문과 전체 링크는 테스트 메모리에서만 비교하고 기록하지 않는다. DB 전 컬럼, 액션 응답, 서버 로그, 감사 레코드를 검사해 원문/전체 링크 부재를 단언한다. fake는 서버 메모리 전용이며 일반 HTTP 응답으로 토큰을 반환하지 않는다.
- 합성 데이터 전체 정리와 잔존 0건을 확인한다. 공급자 접수와 실제 수신을 혼동하지 않는다. 실제 발송 검증은 NOT VERIFIED.

## Playwright 시나리오

- ops OFF 또는 승인자 미지정: `/accounts/first-super-admin-ops`, `/first-super-admin-ops/<synthetic-token>` 각각 notFound. 완료 표식 존재 시에도 같은 결과.
- 격리 정상 경로: 합성 ADMIN 로그인 → 대면 승인 → 격리 fake 전달 → 본인 수락 → 실행 → 화면 notFound 및 계정/증거 원자성 확인. fake 토큰을 HTTP로 노출하지 않으므로 기존 P7 E2E처럼 격리 테스트에서 제어하는 합성 tokenHash 수락 행을 이용하거나 별도 동일 프로세스 테스트 어댑터를 사용한다. 인증되지 않은 승인/실행 거부, STAFF 거부, 중복 수락 거부도 확인한다.
