"use client";

import { useEffect, useRef, useState } from "react";
import { CopyControl } from "@/components/application-ux/copy-control";
import { FormFeedback } from "@/components/application-ux/form-feedback";
import { Button } from "@/components/ui/button";
import { createCompanionInvitation, notifyApplicationDeposit, revokeCompanionInvitation } from "./completion-actions";

type CompletionGuideProps = {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  payerName: string | null;
  applications: Array<{ id: string; childName: string | null; quotedAmount: number }>;
  initiallyNotified?: boolean;
};
const NOTIFIED_MESSAGE = "입금 알림을 보냈습니다. 운영자 확인을 기다려주세요.";

export function CompletionGuide({ bankName, accountNumber, accountHolder, payerName, applications, initiallyNotified = false }: CompletionGuideProps) {
  const [clientReady, setClientReady] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => { setClientReady(true); setOrigin(window.location.origin); }, []);
  const [notified, setNotified] = useState(initiallyNotified);
  const [depositError, setDepositError] = useState<string>();
  const [companionUrl, setCompanionUrl] = useState<string>();
  const [inviteNotice, setInviteNotice] = useState<string>();
  const [inviteError, setInviteError] = useState<string>();
  const [inviteUncertain, setInviteUncertain] = useState(false);
  const [processing, setProcessing] = useState<"notify" | "create" | "cancel">();
  // A synchronous guard also covers two activations before React renders disabled.
  const inFlight = useRef(false);
  const notificationRecorded = useRef(initiallyNotified);
  const currentInvite = useRef<string | undefined>(undefined);
  const uncertainInvite = useRef(false);
  // Only sum the server-stored submission snapshots supplied by the completion view.
  const total = applications.reduce((sum, application) => sum + application.quotedAmount, 0);

  async function handleDepositNotify() {
    if (!clientReady || inFlight.current || notificationRecorded.current) return;
    inFlight.current = true; setProcessing("notify"); setDepositError(undefined);
    try {
      const result = await notifyApplicationDeposit();
      if (result.notified) {
        notificationRecorded.current = true; setNotified(true);
      } else {
        setDepositError("현재 신청에서는 입금 알림을 기록할 수 없습니다.");
      }
    } catch {
      // A lost response may follow a committed first timestamp. Do not claim failure.
      setDepositError("입금 알림 처리 결과를 확인하지 못했습니다. 새로고침하여 접수 여부를 확인해 주세요.");
    } finally { inFlight.current = false; setProcessing(undefined); }
  }

  async function handleInviteCreate() {
    if (!clientReady || inFlight.current || currentInvite.current || uncertainInvite.current) return;
    inFlight.current = true; setProcessing("create"); setInviteNotice(undefined); setInviteError(undefined);
    try {
      const result = await createCompanionInvitation();
      if (result.url) {
        currentInvite.current = result.url; setCompanionUrl(result.url);
        setInviteNotice("친구 보호자 초대 링크를 만들었습니다.");
      } else {
        setInviteError("초대 링크를 만들 수 없습니다. 잠시 후 다시 시도해 주세요.");
      }
    } catch {
      // The action has no replay/recovery contract: an unknown result must not mint again.
      uncertainInvite.current = true; setInviteUncertain(true);
      setInviteError("초대 링크 생성 결과를 확인하지 못했습니다. 운영자에게 문의해 주세요.");
    } finally { inFlight.current = false; setProcessing(undefined); }
  }

  async function handleInviteCancel() {
    if (!clientReady || inFlight.current || !currentInvite.current) return;
    inFlight.current = true; setProcessing("cancel"); setInviteNotice(undefined); setInviteError(undefined);
    try {
      const result = await revokeCompanionInvitation(currentInvite.current);
      if (result.revoked) {
        currentInvite.current = undefined; setCompanionUrl(undefined);
        setInviteNotice("친구 보호자 초대 링크를 취소했습니다.");
      } else {
        setInviteError("초대 링크 취소를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } catch {
      setInviteError("초대 링크 취소를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally { inFlight.current = false; setProcessing(undefined); }
  }

  return <div className="min-w-0 space-y-6">
    <section aria-labelledby="completion-amounts-heading" className="min-w-0 space-y-4 rounded-lg border bg-white p-4 sm:p-6">
      <h2 className="text-lg font-semibold" id="completion-amounts-heading">신청 금액</h2>
      <p className="text-sm text-slate-600">신청서를 제출할 때 저장된 아이별 금액입니다.</p>
      <ul className="space-y-3 text-sm">{applications.map((application) => <li className="flex items-baseline justify-between gap-4" key={application.id}>
        <span className="min-w-0 break-all">{application.childName ?? "아이"}</span>
        <strong className="shrink-0">{application.quotedAmount.toLocaleString("ko-KR")}원</strong>
      </li>)}</ul>
      <p className="flex flex-wrap justify-between gap-2 border-t pt-3 font-semibold"><span>총 입금액</span><strong>{total.toLocaleString("ko-KR")}원</strong></p>
    </section>

    <section aria-labelledby="completion-deposit-heading" className="min-w-0 space-y-5 rounded-lg border bg-white p-4 sm:p-6">
      <h2 className="text-lg font-semibold" id="completion-deposit-heading">무통장 입금 안내</h2>
      <dl className="space-y-4 text-sm">
        <div className="flex items-baseline justify-between gap-4"><dt className="shrink-0 text-slate-500">은행</dt><dd className="min-w-0 break-all text-right">{bankName}</dd></div>
        <div className="space-y-2"><dt className="text-slate-500">계좌번호</dt><dd><CopyControl buttonLabel="계좌번호 복사" label="계좌번호" rows={2} successMessage="계좌번호를 복사했습니다." value={accountNumber} valueLabel="계좌번호 복사 값" /></dd></div>
        <div className="flex items-baseline justify-between gap-4"><dt className="shrink-0 text-slate-500">예금주</dt><dd className="min-w-0 break-all text-right">{accountHolder}</dd></div>
        <div className="space-y-2"><dt className="text-slate-500">입금자명</dt><dd>
          {payerName ? <CopyControl buttonLabel="입금자명 복사" label="입금자명" rows={2} successMessage="입금자명을 복사했습니다." value={payerName} valueLabel="입금자명 복사 값" /> : <span>-</span>}
        </dd></div>
        <div className="space-y-2"><dt className="text-slate-500">입금액</dt><dd className="space-y-2">
          <p className="font-semibold">{total.toLocaleString("ko-KR")}원</p>
          <p className="text-xs text-slate-600">복사 값은 쉼표와 원 표시가 없는 숫자입니다.</p>
          <CopyControl buttonLabel="입금액 복사" label="입금액" rows={1} successMessage="입금액을 복사했습니다." value={String(total)} valueLabel="입금액 복사 값 (숫자만)" />
        </dd></div>
      </dl>
      <div className="space-y-3 border-t pt-4">
        <h3 className="font-semibold">다음 순서</h3>
        <p className="break-words text-sm">안내된 금액 송금 → 입금했어요 → 운영자 실제 입금 확인 → 예약 확정</p>
        <p className="text-sm text-slate-600" id="deposit-notification-help">송금을 마친 뒤 눌러주세요. 운영자에게 알림을 남기며 실제 입금 확인이나 예약 확정을 대신하지 않습니다.</p>
        {notified ? <FormFeedback notice={NOTIFIED_MESSAGE} /> : <Button aria-describedby="deposit-notification-help" className="min-h-11 w-full sm:w-auto" disabled={!clientReady || !!processing} onClick={handleDepositNotify} type="button">{processing === "notify" ? "입금 알림 처리 중..." : "입금했어요"}</Button>}
        <FormFeedback error={depositError} notice={processing === "notify" ? "입금 알림을 처리하고 있습니다." : undefined} />
      </div>
    </section>

    <section aria-labelledby="completion-invite-heading" className="min-w-0 space-y-3 rounded-lg border bg-slate-50 p-4 sm:p-6">
      <h2 className="text-base font-semibold" id="completion-invite-heading">친구 보호자 초대</h2>
      <p className="text-sm text-slate-600">초대받은 보호자는 본인의 정보를 직접 입력하고 필요한 동의를 진행합니다.</p>
      {companionUrl ? <div className="space-y-3">
        <CopyControl buttonLabel="초대 링크 복사" disabled={processing === "cancel"} label="초대 링크" successMessage="초대 링크를 복사했습니다." value={`${origin}${companionUrl}`} valueLabel="초대 링크 복사 값" />
        <Button className="min-h-11 w-full border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 sm:w-auto" disabled={!clientReady || !!processing} onClick={handleInviteCancel} type="button">{processing === "cancel" ? "초대 취소 중..." : "초대 취소"}</Button>
      </div> : <Button className="min-h-11 w-full border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 sm:w-auto" disabled={!clientReady || !!processing || inviteUncertain} onClick={handleInviteCreate} type="button">{processing === "create" ? "초대 링크 만드는 중..." : "초대 링크 만들기"}</Button>}
      <FormFeedback error={inviteError} notice={processing === "create" ? "초대 링크를 만들고 있습니다." : processing === "cancel" ? "초대 링크를 취소하고 있습니다." : inviteNotice} />
    </section>
  </div>;
}
