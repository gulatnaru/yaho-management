"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { issueApplicationLink, stopApplicationLink, upgradeLegacyApplicationLink } from "@/app/(admin)/reservation-applications/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ApplicationLinkAdminState } from "@/lib/reservation-applications/availability";

const STATE_DESCRIPTION: Record<ApplicationLinkAdminState, string> = {
  NONE: "아직 만든 링크가 없습니다.",
  OPEN: "접수 중입니다. 이 링크를 보호자에게 보내 주세요.",
  STOPPED: "중지된 링크입니다. 재발급하면 새 링크로 다시 접수합니다.",
  CLASS_CANCELLED: "취소된 클래스라 신청을 받지 않습니다.",
  CLASS_STARTED: "이미 시작했거나 끝난 클래스라 신청을 받지 않습니다.",
  RUNTIME_NOT_READY: "운영 설정(입금 안내·채널 링크 또는 동의 문구)이 준비되지 않아 신청을 받지 않습니다.",
};

export interface ApplicationLinkCardProps {
  classScheduleId: string;
  applicationPrice: number | null;
  upgradedGroupId?: string | null;
  state: ApplicationLinkAdminState;
  link: { token: string; isActive: boolean; issuedAtLabel: string; issuedByName: string } | null;
}

/**
 * ADMIN 전용 클래스 신청 링크 카드(ADR-052/053). 링크 주소는 현재 접속한 주소(origin) 기준으로 만든다.
 * 재발급·중지는 되돌릴 수 없으므로 한 번 더 확인받는다.
 */
export function ApplicationLinkCard({ classScheduleId, applicationPrice, upgradedGroupId, state, link }: ApplicationLinkCardProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [origin, setOrigin] = useState("");
  const router = useRouter();

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const classClosed = state === "CLASS_CANCELLED" || state === "CLASS_STARTED";
  const showUrl = Boolean(link?.isActive) && !classClosed;
  const url = link && origin ? `${origin}/apply/${link.token}` : "";

  function run(action: () => Promise<{ error?: string }>, confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setError(undefined);
    setNotice(undefined);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  async function copyLink() {
    setError(undefined);
    try {
      await navigator.clipboard.writeText(url);
      setNotice("링크를 복사했습니다.");
    } catch {
      setError("복사하지 못했습니다. 주소를 길게 눌러 직접 복사해주세요.");
    }
  }

  return (
    <Card data-testid="application-link-card">
      <CardHeader>
        <CardTitle>예약 신청 링크</CardTitle>
        <CardDescription>{STATE_DESCRIPTION[state]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {showUrl ? (
          <Input
            aria-label="예약 신청 링크 주소"
            onFocus={(event) => event.currentTarget.select()}
            readOnly
            value={url}
          />
        ) : null}
        {link ? (
          <p className="text-xs text-slate-500">
            최근 발급 {link.issuedAtLabel} · {link.issuedByName}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 md:flex-row">
          {showUrl ? (
            <Button className="w-full md:w-auto" disabled={!url || pending} onClick={copyLink} type="button">
              링크 복사
            </Button>
          ) : null}
          {!classClosed && !upgradedGroupId ? (
            <Button
              className="w-full md:w-auto"
              disabled={pending}
              onClick={() =>
                run(
                  () => issueApplicationLink(classScheduleId),
                  link ? "재발급하면 지금 링크는 바로 쓸 수 없게 됩니다. 재발급할까요?" : undefined,
                )
              }
              type="button"
            >
              {pending ? "처리 중..." : link ? "재발급" : "링크 만들기"}
            </Button>
          ) : null}
          {link && applicationPrice && !classClosed && !upgradedGroupId ? <Button className="w-full md:w-auto" disabled={pending} onClick={() => run(async () => {
            const result = await upgradeLegacyApplicationLink(classScheduleId);
            if (result.groupId) setNotice("기존 주소를 그룹 신청 링크로 전환했습니다.");
            return result;
          }, "기존 주소는 유지하고 그룹 신청 방식으로 전환합니다. 계속할까요?")} type="button">그룹 신청으로 전환</Button> : null}
          {upgradedGroupId ? <a className="text-sm underline" href={`/reservation-applications/groups/${upgradedGroupId}`}>그룹 신청 관리</a> : null}
          {showUrl ? (
            <Button
              className="w-full md:w-auto"
              disabled={pending}
              onClick={() =>
                run(
                  () => stopApplicationLink(classScheduleId),
                  "중지하면 이 링크로 더는 신청할 수 없습니다. 중지할까요?",
                )
              }
              type="button"
            >
              중지
            </Button>
          ) : null}
        </div>

        {notice ? (
          <p aria-live="polite" className="text-sm text-emerald-700" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p aria-live="polite" className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
