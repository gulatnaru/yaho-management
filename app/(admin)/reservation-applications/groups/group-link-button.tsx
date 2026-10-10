"use client";

import { useState, useTransition } from "react";
import { issueApplicationGroupLink, stopApplicationGroup } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function GroupLinkButton({ groupId, isActive }: { groupId: string; isActive: boolean }) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  return <div className="space-y-2"><div className="flex flex-wrap gap-2"><Button disabled={pending} onClick={() => startTransition(async () => { setError(undefined); const result = await issueApplicationGroupLink(groupId); if (result.error || !result.token) setError(result.error ?? "링크를 만들지 못했습니다."); else setUrl(`${window.location.origin}/apply/group/${result.token}`); })} type="button">{pending ? "처리 중..." : isActive ? "접수 링크 발급·재발급" : "접수 재개·새 링크 발급"}</Button><Button disabled={!isActive || pending} onClick={() => startTransition(async () => { setError(undefined); const result = await stopApplicationGroup(groupId); if (result.error) setError(result.error); else setUrl(undefined); })} type="button">접수 중지</Button></div>{!isActive ? <p className="text-sm text-slate-500">중지된 그룹입니다. 새 링크를 발급하면 다시 접수합니다.</p> : null}{url ? <Input aria-label="신청 그룹 링크" onFocus={(event) => event.currentTarget.select()} readOnly value={url} /> : null}{error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}</div>;
}
