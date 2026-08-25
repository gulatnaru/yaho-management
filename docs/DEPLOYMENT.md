# Phase 1 Deployment

Vercel 프로젝트는 GitHub 저장소와 연결한다. `main`은 Production, pull request는 Preview 배포를 사용한다.

## Region

- Vercel 함수(Serverless Function) 리전은 `syd1`(시드니)로 설정한다.
- Supabase DB가 시드니 리전에 있어, 함수를 같은 리전에 두면 함수-DB 간 요청마다 발생하는 네트워크 왕복(round trip)이 줄어든다. 실제로 이 설정 후 응답 속도가 눈에 띄게 빨라진 것을 확인했다.
- DB 리전을 나중에 서울로 옮기면 함수 리전도 반드시 함께 옮겨야 한다. 함수와 DB가 다른 리전에 있으면 모든 DB 요청이 리전 간 왕복을 거치게 되어 이 설정의 이점이 사라지고 오히려 지연이 늘어난다.

## Environment separation

- Production의 `DATABASE_URL`과 `DIRECT_URL`은 운영 Supabase DB를 사용한다.
- Preview의 `DATABASE_URL`과 `DIRECT_URL`은 운영 DB와 분리된 Preview 전용 Supabase 프로젝트 1개를 사용한다. 모든 PR의 Preview 배포가 이 프로젝트 하나를 공유하며, PR/브랜치별 DB Branching은 쓰지 않는다(ADR-030).
- `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`도 Vercel 환경별로 따로 등록한다.
- `.env`와 실제 값을 Git에 커밋하지 않는다.

## Environment variables

Vercel 프로젝트 설정의 Environment Variables에 아래를 Production/Preview 각각 등록한다. 값 자체는 Vercel 대시보드에만 존재하며 이 문서나 Git에 남기지 않는다.

| 변수 | Production | Preview |
|---|---|---|
| `DATABASE_URL` | 운영 Supabase 프로젝트 연결 문자열 | Preview 전용 Supabase 프로젝트 연결 문자열(ADR-030) |
| `DIRECT_URL` | 운영 Supabase 프로젝트 direct 연결 문자열 | Preview 전용 Supabase 프로젝트 direct 연결 문자열 |
| `AUTH_SECRET` | 운영 전용 값 | Preview 전용 값 — Production과 반드시 다른 값을 쓴다 |
| `NEXTAUTH_URL` | 비워 둔다 | 비워 둔다 |
| `ADMIN_EMAIL` | 운영 관리자 계정 | Preview 전용 관리자 계정 |
| `ADMIN_PASSWORD` | 운영 전용 값 | Preview 전용 값 |

- `AUTH_SECRET`은 Production과 Preview가 같은 값을 쓰지 않는다 — 한쪽이 유출돼도 다른 환경의 세션을 위조할 수 없어야 한다.
- `NEXTAUTH_URL`은 두 환경 모두 값을 채우지 않고 비워 둔다. Vercel은 요청 헤더로 배포 URL을 자동 감지하므로, 값을 채우면 오히려 PR마다 달라지는 Preview URL과 어긋나 인증이 깨질 수 있다.

## Build

- Vercel Build Command는 기본값(`next build`)을 그대로 쓴다. 별도로 `prisma generate`를 Build Command에 추가하지 않는다.
- 대신 `package.json`의 `postinstall`에서 `prisma generate`를 실행한다. Vercel은 빌드 간 `node_modules`를 캐시하는데, `postinstall`이 없으면 `schema.prisma`가 바뀌어도 Prisma Client가 재생성되지 않아 stale client로 배포될 위험이 있다. `postinstall`은 install 단계마다 실행되므로 이 위험을 없앤다.

## Migration policy

- Vercel의 Build Command에는 `prisma migrate deploy`를 넣지 않는다.
- Preview 배포에서는 migration을 자동 실행하지 않는다.
- Production migration은 승인된 배포 절차에서 별도로 `prisma migrate deploy`를 실행한다.
