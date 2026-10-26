"use client";

import { useState } from "react";
import { CopyControl } from "@/components/application-ux/copy-control";
import { Button } from "@/components/ui/button";
import { buildAdminShareFeed, isKakaoShareConfigured } from "@/lib/kakao/share";
import { requestKakaoShare } from "@/lib/kakao/sdk";

/** Render only behind the page's server-side ADMIN authorization guard. */
export function AdminLinkShare({ adminUrl }: { adminUrl: string }) {
  const configured = isKakaoShareConfigured();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>();

  async function share() {
    setLoading(true);
    setMessage(undefined);
    try {
      const result = await requestKakaoShare(buildAdminShareFeed(adminUrl));
      if (result.status === "opened") setMessage("카카오톡 공유 화면을 열었습니다. 전송 여부는 카카오톡에서 확인하세요.");
      else if (result.status === "unconfigured") setMessage("카카오 JavaScript 키가 설정되지 않았습니다. 관리자 링크 복사를 이용해 주세요.");
      else if (result.status === "failed") setMessage("카카오톡 공유 화면을 열지 못했습니다. 관리자 링크 복사를 이용해 주세요.");
    } catch {
      setMessage("카카오톡 공유 화면을 열지 못했습니다. 관리자 링크 복사를 이용해 주세요.");
    } finally { setLoading(false); }
  }

  return <section aria-label="관리자 전용 상세 링크" className="mt-6 min-w-0 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
    <h2 className="font-semibold">관리자 전용 상세 링크</h2>
    <p className="text-sm text-slate-600">이 링크는 관리자(ADMIN) 로그인이 필요합니다. 고객에게 보내지 마세요. 카카오톡으로 공유할 때도 받는 사람은 관리자여야 합니다.</p>
    <CopyControl value={adminUrl} label="관리자 상세 링크" buttonLabel="관리자 링크 복사" rows={2} />
    <p className="text-sm text-slate-600">공유 버튼을 누르면 카카오톡에서 받는 사람을 직접 선택합니다. 자동으로 메시지를 보내지 않습니다.</p>
    <Button aria-label="카카오톡으로 공유" className="min-h-11 w-full md:w-auto" disabled={!configured || loading} onClick={share} type="button">
      {loading ? "카카오톡 공유 준비 중…" : "카카오톡으로 공유"}
    </Button>
    {!configured && <p className="text-sm text-slate-600">카카오 JavaScript 키가 설정되지 않았습니다. 관리자 링크 복사를 이용해 주세요.</p>}
    <p aria-live="polite" className="text-sm text-slate-700" role="status">{message}</p>
  </section>;
}
