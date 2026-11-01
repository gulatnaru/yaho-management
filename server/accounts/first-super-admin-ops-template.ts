// 문구 승인 대기. A separate approved change is needed before real delivery.
export const BOOTSTRAP_TEMPLATE_APPROVED = false;
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function bootstrapEmail(email: string, acceptUrl: string) {
  return {
    text: `YAHO 최초 최고관리자 등록 수락 안내\n대상 이메일: ${email}\n수락 링크: ${acceptUrl}\n이 링크는 72시간 동안 유효합니다.\n본인 신청이 아니라면 이 메일을 무시해주세요.\n이메일로 비밀번호를 요청하지 않습니다.`,
    html: `<h1>YAHO 최초 최고관리자 등록 수락 안내</h1><p>대상 이메일: ${escapeHtml(email)}</p><p><a href="${escapeHtml(acceptUrl)}">등록 수락</a></p><p>이 링크는 72시간 동안 유효합니다.</p><p>본인 신청이 아니라면 이 메일을 무시해주세요.</p><p>이메일로 비밀번호를 요청하지 않습니다.</p>`,
  };
}
