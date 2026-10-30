import type { DeliveryResult, InvitationDelivery } from "./delivery";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function invitationEmail(email: string, acceptUrl: string) {
  const text = `YAHO 관리자 계정 초대\n대상 이메일: ${email}\n계정 설정: ${acceptUrl}\n이 링크는 72시간 동안 유효합니다.\n요청하지 않았다면 이 메일을 무시해주세요.\n저희는 이메일로 비밀번호를 요청하지 않습니다.`;
  const html = `<h1>YAHO 관리자 계정 초대</h1><p>대상 이메일: ${escapeHtml(email)}</p><p><a href="${escapeHtml(acceptUrl)}">계정 설정</a></p><p>이 링크는 72시간 동안 유효합니다.</p><p>요청하지 않았다면 이 메일을 무시해주세요.</p><p>저희는 이메일로 비밀번호를 요청하지 않습니다.</p>`;
  return { text, html };
}

export function resendDelivery(apiKey: string, sender: string, request: typeof fetch = fetch): InvitationDelivery {
  return {
    async sendInvitation(input): Promise<DeliveryResult> {
      if (!input.invitationId || !input.attemptId) return { status: "FAILED", errorCategory: "CONFIG" };
      const body = invitationEmail(input.email, input.acceptUrl);
      try {
        const response = await request("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `invitation/${input.invitationId}/${input.attemptId}` },
          body: JSON.stringify({ from: sender, to: [input.email], subject: "YAHO 관리자 계정 초대", ...body, headers: { "X-Entity-Ref-ID": input.invitationId } }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return { status: "FAILED", errorCategory: response.status === 429 ? "LIMIT" : response.status === 401 || response.status === 403 ? "AUTH" : "PROVIDER" };
        const data: unknown = await response.json();
        if (typeof data !== "object" || data === null || !("id" in data) || typeof data.id !== "string" || !data.id) return { status: "UNKNOWN", errorCategory: "INVALID_RESPONSE" };
        return { status: "ACCEPTED", providerMessageId: data.id };
      } catch { return { status: "UNKNOWN", errorCategory: "NETWORK" }; }
    },
  };
}
