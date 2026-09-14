import Link from "next/link";
import { requireCurrentPrincipal, type CurrentPrincipal } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";
import { NavDrawer } from "./_components/nav-drawer";

const OPERATIONAL_NAV_ITEMS = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/children", label: "아이 관리" },
  { href: "/teachers", label: "선생님 관리" },
  { href: "/programs", label: "프로그램 관리" },
  { href: "/classes", label: "클래스 일정" },
  { href: "/reservations", label: "예약 관리" },
];

function getNavigationItems(principal: CurrentPrincipal) {
  if (principal.role === "TEACHER") {
    return [
      { href: "/dashboard", label: "대시보드" },
      { href: "/classes", label: "내 클래스" },
      { href: `/teachers/${principal.teacherId}`, label: "내 정보" },
      { href: "/account/password", label: "비밀번호 변경" },
    ];
  }

  return [
    ...OPERATIONAL_NAV_ITEMS,
    ...(principal.role === "ADMIN"
      ? [
          { href: "/payments", label: "결제·환불" },
          { href: "/revenue", label: "매출 집계" },
          { href: "/accounts", label: "계정 관리" },
        ]
      : []),
    { href: "/account/password", label: "비밀번호 변경" },
  ];
}

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const principal = await requireCurrentPrincipal();
  const displayName = principal.name || principal.email;
  const navigationItems = getNavigationItems(principal);

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <NavDrawer items={navigationItems} userLabel={displayName}>
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
