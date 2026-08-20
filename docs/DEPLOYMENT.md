# Phase 1 Deployment

Vercel 프로젝트는 GitHub 저장소와 연결한다. `main`은 Production, pull request는 Preview 배포를 사용한다.

## Environment separation

- Production의 `DATABASE_URL`과 `DIRECT_URL`은 운영 Supabase DB를 사용한다.
- Preview의 `DATABASE_URL`과 `DIRECT_URL`은 운영 DB와 분리된 Preview 전용 Supabase 프로젝트 또는 DB branch를 사용한다.
- `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`도 Vercel 환경별로 따로 등록한다.
- `.env`와 실제 값을 Git에 커밋하지 않는다.

## Migration policy

- Vercel의 Build Command에는 `prisma migrate deploy`를 넣지 않는다.
- Preview 배포에서는 migration을 자동 실행하지 않는다.
- Production migration은 승인된 배포 절차에서 별도로 `prisma migrate deploy`를 실행한다.
