-- P1 DRAFT (미적용, 격리 작업 영역 초안): Admin RBAC P1 — Role enum 확장 + 기본값 제거.
-- 위치 주의: prisma/migrations/ 안에 두면 AI-service Preview migration 정책 테스트(15개 고정)가
-- 깨지므로, 정책 스캔 대상이 아닌 migrations-DRAFT/에 둔다. 정식 통합 시 이 초안을
-- 실제 migration 디렉터리로 재생성하고, 카카오 미커밋 migration
-- (20261026090000_notification_outbox, 20261028090000_notification_dispatch_guard)과의
-- 순서·충돌을 재확인해야 한다. 실제 Preview/Production DB에는 적용하지 않는다.
-- 주의: PostgreSQL의 ALTER TYPE ... ADD VALUE는 트랜잭션 블록 안에서 실행할 수 없어
-- prisma migrate deploy(트랜잭션 실행)와 직접 호환되지 않는다. 따라서 아래와 같이
-- 새 enum 타입을 만들고 컬럼 타입을 교체하는 방식을 쓴다.
-- 기존 행 영향: 기본값 제거는 신규 행에만 적용되며 기존 행의 role 값은 변하지 않는다.
-- CHECK "user_teacher_role_consistency" (role='TEACHER' = teacherId IS NOT NULL)는
-- 새 값에도 그대로 유효하다 (SUPER_ADMIN·STAFF는 teacherId NULL이어야 코드에서 강제).

CREATE TYPE "Role_new" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEACHER', 'STAFF');
-- 기본값이 남아 있으면 컬럼 타입 교체 시 자동 형변환이 불가하므로, 타입 교체 전에 기본값을 먼저 제거한다.
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
-- CHECK "user_teacher_role_consistency"가 구 enum 타입을 참조하므로, 타입 교체 전에 제약을
-- 제거하고 교체 후에 새 타입 기준으로 다시 추가한다. (제거하지 않으면
-- 'operator does not exist: "Role_new" = "Role"' 오류로 타입 교체가 실패한다.)
ALTER TABLE "User" DROP CONSTRAINT "user_teacher_role_consistency";
-- "Role" enum을 쓰는 컬럼은 3곳이다 (User.role, UserAccountChange.previousRole/nextRole).
-- 감사 컬럼까지 새 타입으로 교체하지 않으면 구 타입(Role_old)에 의존성이 남아 DROP TYPE이 실패한다.
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TABLE "UserAccountChange" ALTER COLUMN "previousRole" TYPE "Role_new" USING ("previousRole"::text::"Role_new");
ALTER TABLE "UserAccountChange" ALTER COLUMN "nextRole" TYPE "Role_new" USING ("nextRole"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
ALTER TABLE "User" ADD CONSTRAINT "user_teacher_role_consistency" CHECK ((role = 'TEACHER') = ("teacherId" IS NOT NULL));
