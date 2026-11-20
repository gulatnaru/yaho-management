-- H-1: DB-layer hardening for approved POLICY guidance (OQ-E follow-up).
-- The code gate (saveApprovedGuidance) already checks sha256 against the registry;
-- this CHECK enforces the same approved set for any write path, including direct SQL.
-- Each literal below is byte-identical to an approved POLICY text;
-- sha256(literal) must equal the registry entry (v1: 6fac3ee24c783017d897bc90f452cc6ae8279aa889f99ef51e45d7e1e2c2e748).
ALTER TABLE "AiServiceKnowledgeEntry"
  ADD CONSTRAINT "ai_service_knowledge_entry_policy_content"
  CHECK (NOT ("topic" = 'POLICY' AND "approved")
         OR "content" IN ($policy$신청 마감 및 신청 방법

야호 숲체험은 수업 전날까지 신청하면 됩니다. 신청이 몰리면 조기 마감될 수 있습니다. 신청 링크를 통해 접수할 수 있고, 입금 확인 후 예약이 확정됩니다.

참여 연령 및 보호자 동반

야호 숲체험은 어린이를 대상으로 합니다. 보호자 없이 아이들만 선생님과 함께 참여하는 수업입니다.$policy$));
