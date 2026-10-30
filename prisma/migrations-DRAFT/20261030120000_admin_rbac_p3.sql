-- P3 DRAFT (미적용, 격리 작업 영역 초안): Admin RBAC P3 — AdminInvitation 모델 신설 + UserAccountChangeType 확장.
-- 위치 주의: prisma/migrations/ 안에 두면 AI-service Preview migration 정책 테스트(15개 고정)가
-- 깨지므로, 정책 스캔 대상이 아닌 migrations-DRAFT/에 둔다. 정식 통합 시 이 초안을
-- 실제 migration 디렉터리로 재생성하고, 카카오 미커밋 migration
-- (20261026090000_notification_outbox, 20261028090000_notification_dispatch_guard)과의
-- 순서·충돌을 재확인해야 한다. 실제 Preview/Production DB에는 적용하지 않는다.
-- 주의: PostgreSQL의 ALTER TYPE ... ADD VALUE는 트랜잭션 블록 안에서 실행할 수 없어
-- prisma migrate deploy(트랜잭션 실행)와 직접 호환되지 않는다. 따라서 P1 draft와 동일하게
-- 새 enum 타입을 만들고 컬럼 타입을 교체하는 방식을 쓴다.
-- UserAccountChangeType을 참조하는 CHECK 제약은 없으므로 (해당 타입을 쓰는 컬럼은
-- UserAccountChange.type 1곳뿐), 제약 해제·재추가 없이 교체한다.
-- 원본 토큰은 이 migration 어디에도 저장되지 않는다 (tokenHash만 저장).

CREATE TYPE "UserAccountChangeType_new" AS ENUM ('CREATED', 'EMAIL_CHANGED', 'ROLE_CHANGED', 'ACTIVE_CHANGED', 'PASSWORD_RESET', 'INVITATION_ISSUED', 'INVITATION_ACCEPTED', 'INVITATION_EXPIRED', 'INVITATION_REVOKED', 'INVITATION_RESENT');
ALTER TABLE "UserAccountChange" ALTER COLUMN "type" TYPE "UserAccountChangeType_new" USING ("type"::text::"UserAccountChangeType_new");
ALTER TYPE "UserAccountChangeType" RENAME TO "UserAccountChangeType_old";
ALTER TYPE "UserAccountChangeType_new" RENAME TO "UserAccountChangeType";
DROP TYPE "UserAccountChangeType_old";

CREATE TABLE "AdminInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "issuedById" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminInvitation_tokenHash_key" ON "AdminInvitation"("tokenHash");
CREATE INDEX "AdminInvitation_email_createdAt_idx" ON "AdminInvitation"("email", "createdAt");
CREATE INDEX "AdminInvitation_issuedById_createdAt_idx" ON "AdminInvitation"("issuedById", "createdAt");
CREATE INDEX "AdminInvitation_targetUserId_createdAt_idx" ON "AdminInvitation"("targetUserId", "createdAt");

ALTER TABLE "AdminInvitation" ADD CONSTRAINT "AdminInvitation_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminInvitation" ADD CONSTRAINT "AdminInvitation_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
