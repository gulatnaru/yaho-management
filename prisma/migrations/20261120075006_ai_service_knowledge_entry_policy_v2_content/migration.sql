ALTER TABLE "AiServiceKnowledgeEntry" DROP CONSTRAINT "ai_service_knowledge_entry_policy_content";
ALTER TABLE "AiServiceKnowledgeEntry" ADD CONSTRAINT "ai_service_knowledge_entry_policy_content"
CHECK (NOT ("topic" = 'POLICY' AND "approved") OR "content" IN ($policy$신청 마감 및 신청 방법

야호 숲체험은 수업 전날까지 신청하면 됩니다. 신청이 몰리면 조기 마감될 수 있습니다. 신청 링크를 통해 접수할 수 있고, 입금 확인 후 예약이 확정됩니다.

참여 연령 및 보호자 동반

야호 숲체험은 어린이를 대상으로 합니다. 보호자 없이 아이들만 선생님과 함께 참여하는 수업입니다.$policy$, $policy$1. 신청 마감 및 신청 방법

야호 숲체험은 수업 전날 오후 6시까지 신청할 수 있으며, 정원이 먼저 차면 조기 마감됩니다. 신청 링크를 통해 접수할 수 있고, 입금 확인 후 예약이 확정됩니다.

2. 참여 연령 및 보호자 동반

야호 숲체험은 만 4세부터 만 7세까지의 어린이를 대상으로 합니다. 보호자 없이 아이들만 선생님과 함께 참여하는 수업이며, 한 반의 아동 정원은 기본 8명입니다.$policy$));
