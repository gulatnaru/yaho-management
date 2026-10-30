"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  INVITATION_STATUS_LABELS,
  type InvitationStatus,
} from "@/server/accounts/invitation-queries";
import { cancelInvitation, reissueInvitation, type InvitationRowActionState } from "../actions";

export type InvitationListRow = {
  id: string;
  deliveryAttempt: { status: string } | null;
  email: string;
  role: string;
  expiresAt: Date;
  createdAt: Date;
  status: InvitationStatus;
  targetUser: { id: string; name: string; email: string; isActive: boolean };
};

const INITIAL_STATE: InvitationRowActionState = {};

function CancelButton({ invitationId }: { invitationId: string }) {
  const [state, action, pending] = useActionState(cancelInvitation, INITIAL_STATE);
  return (
    <form action={action} className="inline">
      <input name="invitationId" type="hidden" value={invitationId} />
      <Button disabled={pending} type="submit">
        {pending ? "처리 중..." : "해지"}
      </Button>
      {state.formError ? <span className="ml-2 text-sm text-red-600" role="alert">{state.formError}</span> : null}
    </form>
  );
}

function ReissueButton({ invitationId }: { invitationId: string }) {
  const [state, action, pending] = useActionState(reissueInvitation, INITIAL_STATE);
  return (
    <form action={action} className="inline">
      <input name="invitationId" type="hidden" value={invitationId} />
      <Button disabled={pending} type="submit">
        {pending ? "처리 중..." : "재발급"}
      </Button>
      {state.formError ? <span className="ml-2 text-sm text-red-600" role="alert">{state.formError}</span> : null}
    </form>
  );
}

export function InvitationTable({ invitations }: { invitations: InvitationListRow[] }) {
  if (invitations.length === 0) {
    return <p className="text-sm text-slate-500">발급된 초대가 없습니다.</p>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b text-left text-slate-500">
          <th className="py-2 pr-4">대상</th>
          <th className="py-2 pr-4">역할</th>
          <th className="py-2 pr-4">상태</th>
          <th className="py-2 pr-4">발송</th>
          <th className="py-2 pr-4">만료</th>
          <th className="py-2">관리</th>
        </tr>
      </thead>
      <tbody>
        {invitations.map((invitation) => (
          <tr key={invitation.id} className="border-b">
            <td className="py-2 pr-4">
              {invitation.targetUser.name} ({invitation.email})
            </td>
            <td className="py-2 pr-4">{invitation.role}</td>
            <td className="py-2 pr-4">{INVITATION_STATUS_LABELS[invitation.status]}</td>
            <td className="py-2 pr-4">{invitation.deliveryAttempt?.status === "ACCEPTED" ? "발송 요청 접수" : invitation.deliveryAttempt?.status === "FAILED" ? "발송 실패" : invitation.deliveryAttempt ? "발송 결과 미확인" : "발송 기록 없음"}</td>
            <td className="py-2 pr-4">{new Date(invitation.expiresAt).toLocaleString("ko-KR")}</td>
            <td className="py-2">
              <span className="inline-flex gap-2">
                {invitation.status === "PENDING" ? <CancelButton invitationId={invitation.id} /> : null}
                {invitation.status === "PENDING" || invitation.status === "EXPIRED" || invitation.status === "REVOKED" ? (
                  <ReissueButton invitationId={invitation.id} />
                ) : null}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
