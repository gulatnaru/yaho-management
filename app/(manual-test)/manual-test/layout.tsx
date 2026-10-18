import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "TEST · YAHO manual testing", description: "TEST environment. Synthetic fixtures in an isolated test environment.",
  robots: { index: false, follow: false }, referrer: "no-referrer",
};

export default function ManualTestLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50 text-slate-950">
    <div className="sticky top-0 z-20 border-b-4 border-amber-600 bg-amber-100 px-4 py-3 text-center text-sm font-bold text-amber-950">TEST ENVIRONMENT · ISOLATED TEST DATA · SYNTHETIC DATA ONLY · No real reservations or money</div>
    <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5">
      <Link href="/manual-test/admin" className="text-xl font-bold">YAHO <span className="text-amber-700">TEST LAB</span></Link>
      <span className="text-sm text-slate-600">In-memory fixtures · Data disappears on server restart</span>
    </header>
    <main className="mx-auto max-w-6xl space-y-5 px-4 pb-12">{children}</main>
    <footer className="border-t px-4 py-5 text-center text-sm font-semibold text-amber-800">TEST ONLY · Never enter real customer information</footer>
  </div>;
}
