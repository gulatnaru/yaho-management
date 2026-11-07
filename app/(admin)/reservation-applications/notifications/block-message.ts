import type { BlockResult } from "@/server/kakao/block-action-service";
export function blockMessage(result: BlockResult): string {
  switch (result) {
    case "blocked": return "신규 발송을 차단했습니다.";
    case "already_blocked": return "이미 차단된 상태입니다.";
    case "conflict_blocked": return "다른 명령과 경합했습니다. 현재 이미 차단된 상태입니다.";
    case "failed": return "차단에 실패했습니다. 상태를 확인해 주세요.";
  }
}
