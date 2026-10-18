import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="space-y-4">{children}</CardContent></Card>;
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">{label}{children}</label>;
}
export function Notice({ error, message, busy }: { error: string; message?: string; busy: boolean }) {
  return <div aria-live="polite" aria-atomic="true" className="space-y-2">
    {busy && <p role="status" className="rounded border bg-white p-3 text-sm">TEST · Processing mock request…</p>}
    {error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    {message && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
  </div>;
}
