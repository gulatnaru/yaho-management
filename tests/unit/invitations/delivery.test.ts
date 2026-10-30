import { expect, it } from "vitest";
import { unimplementedInvitationDelivery } from "@/lib/invitations/delivery";

/**
 * P3 → P4 발송 인터페이스: P3에서는 미구현 스텁이 호출 즉시 실패한다.
 * P3 발급 경로는 이 스텁을 호출하지 않으므로, 호출 자체가 배선 오류이다.
 */
it("미구현 발송 스텁은 호출 시 즉시 실패한다 (P4 연결 전 사용 전환 금지)", async () => {
  await expect(
    unimplementedInvitationDelivery.sendInvitation({
      email: "x@example.test",
      acceptUrl: "http://127.0.0.1:1/invite/test",
      expiresAt: new Date(),
    }),
  ).rejects.toThrow("INVITATION_DELIVERY_NOT_IMPLEMENTED_P4");
});
