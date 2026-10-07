"use client";

import { useActionState } from "react";
import { importLegacyReservationApplicationSettings, saveReservationApplicationSettings } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsForm({ settings }: { settings: { bankName: string; accountNumber: string; accountHolder: string; blogUrl: string; instagramUrl: string; kakaoChannelUrl: string } | null }) {
  const [state, action, pending] = useActionState(async (_state: { error?: string }, data: FormData) => saveReservationApplicationSettings(data), {});
  const fields = [["bankName", "은행", settings?.bankName], ["accountNumber", "계좌번호", settings?.accountNumber], ["accountHolder", "예금주", settings?.accountHolder], ["blogUrl", "블로그 HTTPS 주소", settings?.blogUrl], ["instagramUrl", "Instagram HTTPS 주소", settings?.instagramUrl], ["kakaoChannelUrl", "카카오톡 채널 HTTPS 주소", settings?.kakaoChannelUrl]] as const;
  return <div className="max-w-xl space-y-4">{settings ? null : <form action={async () => { await importLegacyReservationApplicationSettings(); }}><Button type="submit">기존 환경 설정 한 번 가져오기</Button></form>}<form action={action} className="space-y-4">{fields.map(([name, label, value]) => <div className="space-y-1.5" key={name}><Label htmlFor={name}>{label}</Label><Input defaultValue={value ?? ""} id={name} name={name} required type={name.endsWith("Url") ? "url" : "text"} /></div>)}{state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}<Button disabled={pending} type="submit">{pending ? "저장 중..." : "저장"}</Button></form></div>;
}
