"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  activateRecipientAction, grantRecipientAssignmentAction, registerRecipientAction,
  revokeRecipientAction, verifyRecipientAction,
  type RecipientActionResult,
} from "./actions";

/**
 * Recipient management forms with useActionState per form: action errors are
 * shown inline (instead of surfacing via the error boundary), and the
 * registration form renders the masked phone ONCE on success. The masked
 * value comes only from the action's return value (derived from the submitted
 * form input) — full digits are never displayed, and nothing is read back
 * from stored data or decryption.
 */
function Result({ result, maskedPhone }: { result: RecipientActionResult | null; maskedPhone?: string }) {
  if (!result) return null;
  if (!result.ok) return <p role="alert">{result.error}</p>;
  return <p role="status">{result.message}{maskedPhone ? ` · 등록된 번호: ${maskedPhone}` : ""}</p>;
}

export function RegisterRecipientForm() {
  const [result, action, pending] = useActionState(registerRecipientAction, null);
  return <form action={action} className="space-y-3 rounded border p-4">
    <h2 className="font-semibold">내 업무용 번호 등록</h2>
    <label className="block space-y-1">전화번호<Input name="phoneNumber" type="tel" inputMode="tel" autoComplete="off" maxLength={32} required /></label>
    <label className="flex items-center gap-2"><Checkbox name="ownWorkNumberConfirmed" required />본인 소유의 업무용 번호임을 확인합니다</label>
    <Button type="submit" disabled={pending}>수신자 등록</Button>
    <Result result={result} maskedPhone={result?.ok ? result.maskedPhone : undefined} />
  </form>;
}

export function VerifyRecipientForm({ registrationId }: { registrationId: string }) {
  const [result, action, pending] = useActionState(verifyRecipientAction, null);
  return <form action={action} className="space-y-2 border-t pt-3">
    <input name="registrationId" type="hidden" value={registrationId} />
    <label className="flex items-center gap-2"><Checkbox name="verifierSelfConfirmed" required />현재 로그인한 ADMIN 본인이 검증합니다</label>
    <label className="flex items-center gap-2"><Checkbox name="callCompletedConfirmed" required />시스템 밖에서 해당 번호로 통화하여 소유 확인을 완료했습니다</label>
    <Button type="submit" disabled={pending}>통화 완료 확인 서명</Button>
    <Result result={result} />
  </form>;
}

export function ActivateRecipientForm({ registrationId }: { registrationId: string }) {
  const [result, action, pending] = useActionState(activateRecipientAction, null);
  return <form action={action}>
    <input name="registrationId" type="hidden" value={registrationId} /><Button type="submit" disabled={pending}>활성화</Button>
    <Result result={result} />
  </form>;
}

export function RevokeRecipientForm({ registrationId }: { registrationId: string }) {
  const [result, action, pending] = useActionState(revokeRecipientAction, null);
  return <form action={action} className="flex flex-wrap items-end gap-2">
    <input name="registrationId" type="hidden" value={registrationId} />
    <label className="space-y-1">해지 사유<Select name="reason" required><option value="withdrawn">동의 철회</option><option value="replaced">수신자 교체</option><option value="verification_stopped">검증 중단</option></Select></label>
    <Button type="submit" disabled={pending}>해지</Button>
    <Result result={result} />
  </form>;
}

export function GrantRecipientAssignmentForm({ admins }: { admins: { id: string; name: string | null }[] }) {
  const [result, action, pending] = useActionState(grantRecipientAssignmentAction, null);
  return <form action={action} className="space-y-3 rounded border p-4">
    <h3 className="font-semibold">직무 부여·해지</h3>
    <label className="block space-y-1">ADMIN<Select name="executorId" required defaultValue=""><option value="" disabled>ADMIN 선택</option>{admins.map((admin) => <option key={admin.id} value={admin.id}>{admin.name} ({admin.id})</option>)}</Select></label>
    <label className="block space-y-1">직무<Select name="assignment" required><option value="register">등록·활성화·해지 (register)</option><option value="verify">소유 확인 검증 (verify)</option></Select></label>
    <label className="block space-y-1">작업<Select name="operation" required><option value="grant">부여</option><option value="revoke">해지</option></Select></label>
    <Button type="submit" disabled={pending}>직무 저장</Button>
    <Result result={result} />
  </form>;
}
