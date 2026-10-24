import type { WizardClass } from "@/lib/reservation-applications/application-draft";
export const money = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
export function PublicClassCard({ item, selected, single, onChange }: { item: WizardClass; selected: boolean; single: boolean; onChange: () => void }) {
  return <article className="min-w-0 space-y-2 rounded-lg border p-4">
    <label className="flex min-h-11 items-center gap-3 break-words font-semibold">
      {!single ? <input checked={selected} className="h-5 w-5 shrink-0" onChange={onChange} type="checkbox" /> : null}{item.label}
    </label>
    {item.description ? <p className="whitespace-pre-wrap break-words text-sm">{item.description}</p> : null}
    {item.targetAge ? <p className="text-sm">대상 연령: {item.targetAge}</p> : null}
    <p className="text-sm">한국 시간 (KST)</p>
    {item.applicationPrice !== null ? <p className="font-semibold">참가비: {money(item.applicationPrice)}</p> : null}
    {single ? <p className="text-sm">이 클래스로 신청합니다.</p> : null}
  </article>;
}
