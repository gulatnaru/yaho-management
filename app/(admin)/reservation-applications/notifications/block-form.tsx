"use client";
import { useActionState } from "react";
import { blockAction } from "./actions";
import { blockMessage } from "./block-message";

export function BlockForm() {
  const [result, action, pending] = useActionState(blockAction, null);
  return <form action={action} className="rounded border p-4 space-y-2">
    <h2 className="font-semibold">신규 발송 즉시 차단</h2>
    <p>이미 시작한 외부 호출은 취소되지 않으며 기존 결과 저장과 대사는 계속됩니다.</p>
    <label>사유 <select name="reason" required defaultValue="operator_stop">
      <option value="operator_stop">운영 중단</option><option value="provider_incident">공급자 장애</option><option value="cost_incident">비용 문제</option><option value="security_incident">보안 문제</option><option value="recovery_pending">복구 확인 대기</option>
    </select></label>{" "}<button type="submit" disabled={pending}>신규 발송 차단</button>
    {result && <p role="status">{blockMessage(result)}</p>}
  </form>;
}
