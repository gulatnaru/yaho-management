/** The provider is trusted with the email body and capability link. Never log either. */
export type DeliveryResult =
  | { status: "ACCEPTED"; providerMessageId: string }
  | { status: "FAILED"; errorCategory: string }
  | { status: "UNKNOWN"; errorCategory: string };

export interface InvitationDelivery {
  sendInvitation(input: {
    email: string;
    acceptUrl: string;
    expiresAt: Date;
    invitationId?: string;
    attemptId?: string;
  }): Promise<DeliveryResult | void>;
}

// Retained for the P3 contract test; it can never deliver mail.
export const unimplementedInvitationDelivery: InvitationDelivery = {
  async sendInvitation() { throw new Error("INVITATION_DELIVERY_NOT_IMPLEMENTED_P4"); },
};
