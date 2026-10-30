/**
 * P3 → P4 발송 인터페이스 분리 (PLAN P4).
 *
 * P3에서는 실제 이메일 발송 서비스를 연동하지 않는다 (OQ-2 = P4 게이트).
 * 초대 발급 코어는 발송을 호출하지 않으며, 이 인터페이스는 P4에서 발송
 * 서비스가 연결될 때 초대 도메인 코드를 바꾸지 않고 재사용하기 위한
 * 경계 정의이다. P4에서 실제 구현체를 제공하고 발급 경로에 연결하기
 * 전까지는, P3 코드만으로는 수신자에게 토큰이 전달될 경로가 없다
 * (수동 전달 우회도 만들지 않는다). 이는 의도된 구조적 차단이다.
 *
 * 실제 이메일 소유권 확인은 P4에서 신뢰할 수 있는 전달 경로가 연결되어야
 * 완성된다. P3의 토큰 수락은 토큰 소지 확인이지, 신뢰 경로를 통한
 * 이메일 소유권 확인이 아니다.
 */

/** P4에서 구현할 발송 계약. 원본 토큰은 이 인터페이스를 통해서만 전달된다. */
export interface InvitationDelivery {
  sendInvitation(input: {
    /** 수신 이메일 (초대 링크 외 개인정보 미포함 — SPEC §6.5). */
    email: string;
    /** 초대 수락 링크 (원본 토큰 포함). 로그·감사에 기록하지 않는다. */
    acceptUrl: string;
    /** 초대 만료 시각 (메일 본문 명시용, OQ-9 72시간). */
    expiresAt: Date;
  }): Promise<void>;
}

/**
 * P4 미구현 스텁. 호출되면 즉시 실패한다 — P3 발급 경로는 이 스텁을
 * 호출하지 않으므로, 호출 자체가 배선 오류이다. P4 구현체가 이 자리를
 * 대체한다.
 */
export const unimplementedInvitationDelivery: InvitationDelivery = {
  async sendInvitation(): Promise<void> {
    throw new Error("INVITATION_DELIVERY_NOT_IMPLEMENTED_P4");
  },
};
