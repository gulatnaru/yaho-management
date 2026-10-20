# Phase 2 전용 PostgreSQL 테스트 환경 — Windows 실행 절차

> **Superseded:** Phase 2 Integration의 기본 실행 경로는 [GitHub Actions 서비스 컨테이너 방식](PHASE2-INTEGRATION-STATUS.md#github-actions-service-container-execution)입니다. PR 또는 수동 실행으로 전용 PostgreSQL 16을 준비하고 검증·마이그레이션·12건 테스트를 수행합니다. 아래 Windows 절차는 과거 참고용으로 보존하며, 실제 CI 실행 전까지 테스트 상태는 UNEXECUTED / BLOCKED입니다.

- 목적: Phase 2 Integration 12건과 Advisory Lock을 실제 PostgreSQL 16에서 검증
- 기준 커밋: `7087eb0`
- 실행 위치: YAHO 개발용 Windows PC (Muse VM에서는 PG 설치·소켓이 차단되어 실행 불가)
- 작성일: 2026-10-20

## 격리 규칙 (절대 준수)

| 항목 | 값 |
|------|-----|
| PostgreSQL | 16 |
| Host | `127.0.0.1` (loopback만) |
| Port | `55432` |
| Database | `yaho_e2e` |
| User | `yaho_e2e` |
| 데이터 | 전용 합성 데이터만 |

- 반드시 **새롭고 비어 있는** 테스트 DB만 사용합니다.
- 기존 Windows PostgreSQL 인스턴스·업무 DB를 삭제·초기화·덮어쓰지 마세요.
- Preview/Production Supabase 연결 문자열·인증정보를 사용하지 마세요.
- 기존 `.env`, `.env.local`, `.env.preview-e2e.local` 파일을 덮어쓰지 마세요. 환경변수는 PowerShell 세션에서만 설정합니다.
- 비밀번호는 합성 테스트용 임의값을 쓰고 Git에 커밋하지 마세요.

이 규칙은 코드의 안전성 검사(`tests/e2e/support/db-safety.ts`의 `assertSafeE2eDatabaseUrls`)와 일치합니다. 호스트·포트·DB명·사용자가 다르면 테스트가 시작 단계에서 중단됩니다.

---

## 1단계: Docker 및 PostgreSQL 설치 상태 확인

PowerShell에서 실행:

```powershell
docker --version
docker ps
```

- 버전이 출력되고 `docker ps`가 표를 반환하면 → **2단계 (Docker 방식)** 으로 진행
- 명령을 찾을 수 없으면 → **2-B단계 (네이티브 방식)** 으로 진행
- 둘 다 불가능하면 여기서 중단하고 BLOCKED로 보고

## 2단계 (Docker 방식): 포트 확인 후 컨테이너 준비

포트 55432 점유 확인:

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 55432
```

- `TcpTestSucceeded : False` → 비어 있음, 계속 진행
- `True` → 이미 무언가 사용 중. 기존 것을 종료하지 말고 중단·보고

컨테이너 실행 (비밀번호는 임의의 합성용 값으로 교체):

```powershell
docker run -d --name yaho-e2e-pg -e POSTGRES_DB=yaho_e2e -e POSTGRES_USER=yaho_e2e -e POSTGRES_PASSWORD=SyntheticTestPw2026 -p 127.0.0.1:55432:5432 postgres:16
docker logs yaho-e2e-pg --tail 20
```

확인 출력: 로그에 `database system is ready to accept connections` 가 보이면 기동 완료.

## 2-B단계 (네이티브 방식): PostgreSQL 16 신규 인스턴스

1. https://www.postgresql.org/download/windows/ 에서 PostgreSQL 16 설치
   - 설치 중 포트 기본값(5432) 충돌을 피하기 위해 설치 마법사에서 포트를 묻는 경우 그대로 두되, 아래에서 별도 클러스터를 새로 만듭니다. 기존 인스턴스가 있으면 건드리지 마세요.
2. 새 전용 클러스터 생성 (관리자 PowerShell, 경로는 설치 위치에 맞게 조정):

```powershell
& "C:\Program Files\PostgreSQL\16\bin\initdb.exe" -D C:\yaho-e2e-data -U yaho_e2e --auth=trust -E UTF8
& "C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe" -D C:\yaho-e2e-data -o "-p 55432 -h 127.0.0.1" -l C:\yaho-e2e-data\server.log start
& "C:\Program Files\PostgreSQL\16\bin\createdb.exe" -h 127.0.0.1 -p 55432 -U yaho_e2e yaho_e2e
```

## 3단계: 기동 확인

```powershell
& "C:\Program Files\PostgreSQL\16\bin\pg_isready.exe" -h 127.0.0.1 -p 55432
```

(Docker 방식이면 컨테이너에 포함된 도구 대신 아래 TCP 확인으로 대체 가능)

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 55432
```

확인 출력: `127.0.0.1:55432 - accepting connections` 또는 `TcpTestSucceeded : True`

## 4단계: 저장소 준비 및 환경변수 설정

```powershell
cd <yaho-management 저장소 경로>
git checkout feature/phase21-ai-service
git pull
npm install
```

환경변수는 이 PowerShell 세션에서만 설정 (파일 수정 금지):

```powershell
$env:DATABASE_URL = "postgresql://yaho_e2e:SyntheticTestPw2026@127.0.0.1:55432/yaho_e2e"
$env:DIRECT_URL = "postgresql://yaho_e2e:SyntheticTestPw2026@127.0.0.1:55432/yaho_e2e"
```

네이티브 방식에서 `--auth=trust`를 썼다면 비밀번호 부분은 아무 값이나 무방합니다.

## 5단계: 새 DB 확인 후 Migration 적용

DB가 비어 있는지 먼저 확인 (테이블이 없어야 함):

```powershell
npx prisma migrate status
```

- `No migration found` / 적용된 마이그레이션 없음 상태이면 계속
- 이미 테이블이 있는 DB라면 **중단** — 전용 신규 DB가 아닙니다

마이그레이션 적용 + Client 생성:

```powershell
npx prisma migrate deploy
npx prisma generate
```

## 6단계: Integration 테스트 실행

```powershell
npx vitest run --config vitest.integration.config.ts
```

대상: `tests/integration/reservation-applications/class-link-issuance.test.ts` (12건)

검증 항목:
- 원자적 Group·Membership·해시 Link 생성
- 중간 실패 시 전체 롤백
- 동일 Operation ID 재시도 / 동일 ID·다른 요청 거부
- 관리자 2명 동시 발급
- stale Revision 충돌
- 링크 교체·중지 동시성
- 기존 링크·과거 신청·금액 불변
- 전체 수정 vs 인라인 참가비 CAS 경쟁
- Phase 18 링크 재발급 경쟁
- 응답 유실 후 중복 토큰 교체 방지
- **Advisory lock 실증**: 위 동시성 케이스들이 `issueClassLinkOperationCore()`의 `tx.$executeRaw + SELECT pg_advisory_xact_lock(...)` 를 실제 PG 16 + Prisma 6.19.3에서 실행합니다. 동시성 테스트가 통과하면 잠금 획득·대기·직렬화·해제가 실증된 것입니다. SQL 오류가 발생하면 그 로그 전문을 보관하세요.

## 7단계: 결과 전달

다음을 Muse 채팅에 붙여넣어 주세요.

1. `docker --version` 또는 네이티브 설치 여부
2. `pg_isready` / 포트 확인 출력
3. `npx prisma migrate status` 및 `migrate deploy` 출력
4. vitest 실행 결과 전문 (통과/실패 건수, 실패 시 오류 로그 전문)

## 8단계: 테스트 환경 종료

Docker 방식:

```powershell
docker stop yaho-e2e-pg
docker rm yaho-e2e-pg
```

네이티브 방식:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe" -D C:\yaho-e2e-data stop
```

테스트 데이터는 전용 합성 데이터뿐이므로 별도 보존이 필요 없습니다.

---

## 이후 단계 (Integration 통과 후)

- 로컬 Next.js 앱 실행 + 합성 ADMIN fixture로 Playwright Chromium 검증
- 가능하면 WebKit 별도 검증 (실제 iPhone Safari 통과로 표기하지 않음)
- 실제 Safari 검증은 별도 항목으로 유지
