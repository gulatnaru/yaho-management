import Link from "next/link";
import { requireCurrentPrincipal, type CurrentPrincipal } from "@/lib/auth/authorization";
import { countPendingReservationApplications } from "@/lib/reservation-applications/queries";

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

function getNavigationItems(principal: CurrentPrincipal, pendingApplicationCount: number | null) {
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
          // 예약 신청 관리는 ADMIN 전용(ADR-053). 자동 알림 대신 처리 대기 건수를 메뉴에 표시한다.
          {
            href: "/reservation-applications",
            label: pendingApplicationCount === null ? "예약 신청 (대기 조회 오류)" : pendingApplicationCount > 0 ? `예약 신청 (대기 ${pendingApplicationCount}가족)` : "예약 신청",
          },
          { href: "/payments", label: "결제·환불" },
          { href: "/revenue", label: "매출 집계" },
          { href: "/accounts", label: "계정 관리" },
          { href: "/ai-consultations", label: "AI 상담 (Mock)" },
        ]
      : []),
    { href: "/account/password", label: "비밀번호 변경" },
  ];
}

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const principal = await requireCurrentPrincipal();
  const displayName = principal.name || principal.email;
  const pendingApplicationCount = principal.role === "ADMIN" ? await countPendingReservationApplications().catch(() => null) : 0;
  const navigationItems = getNavigationItems(principal, pendingApplicationCount);

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <NavDrawer items={navigationItems} userLabel={displayName}>
              <Link className="font-semibold" href="/dashboard">
                YAHO 관리
              </Link>
            </NavDrawer>
          </div>
          <p className="hidden max-w-48 break-words text-sm text-slate-600 md:block">{displayName}</p>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
