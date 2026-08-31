import Link from "next/link";
import { requireAdmin } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";
import { NavDrawer } from "./_components/nav-drawer";

// Phase가 늘어날 때마다 이 배열에 { href, label } 을 추가한다.
const NAV_ITEMS = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/children", label: "아이 관리" },
  { href: "/teachers", label: "선생님 관리" },
  { href: "/programs", label: "프로그램 관리" },
  { href: "/classes", label: "클래스 일정" },
  { href: "/reservations", label: "예약 관리" },
  { href: "/payments", label: "결제·환불" },
  { href: "/revenue", label: "매출 집계" },
];

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireAdmin();
  const displayName = session.user.name ?? session.user.email ?? "";

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <NavDrawer items={NAV_ITEMS} userLabel={displayName}>
              <Link className="font-semibold" href="/dashboard">
                YAHO 관리
              </Link>
            </NavDrawer>
          </div>
          <p className="hidden text-sm text-slate-600 md:block">{displayName}</p>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
