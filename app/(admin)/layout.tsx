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

function getNavigationItems(principal: CurrentPrincipal, pendingApplicationCount: number) {
  if (principal.role === "TEACHER") {
    return [
      { href: "/dashboard", label: "대시보드" },
      { href: "/classes", label: "내 클래스" },
      { href: `/teachers/${principal.teacherId}`, label: "내 정보" },
      { href: "/account/password", label: "비밀번호 변경" },
    ];
  }

  // P1 (OQ-11): STAFF는 확정된 업무 범위(P8) 이외 deny-by-default이므로,
  // 메뉴도 대시보드·비밀번호 변경으로 제한한다 (TEACHER 축소 패턴과 동일 취지).
  if (principal.role === "STAFF") {
    return [
      { href: "/dashboard", label: "대시보드" },
      { href: "/account/password", label: "비밀번호 변경" },
    ];
  }

  // P1 (OQ-11): SUPER_ADMIN은 전체 운영 메뉴를 본다. P2: 계정 관리 메뉴는 SUPER_ADMIN에게만
  // 노출한다 — 메뉴 노출은 표시일 뿐 권한 경계가 아니며, 진입점 가드(queries·actions·코어)가
  // 실제 경계이다. ADMIN은 전환 이후 계정 관리 메뉴를 보지 못하고 진입해도 차단된다.
  const adminMenuItems =
    principal.role === "ADMIN" || principal.role === "SUPER_ADMIN"
      ? [
          // 예약 신청 관리는 ADMIN 전용(ADR-053). 자동 알림 대신 처리 대기 건수를 메뉴에 표시한다.
          // P1: SUPER_ADMIN도 이 메뉴를 보며, 조회 가드는 requireAdminOrSuperAdminPrincipal로 확장됐다.
          {
            href: "/reservation-applications",
            label: pendingApplicationCount > 0 ? `예약 신청 (${pendingApplicationCount})` : "예약 신청",
          },
          { href: "/payments", label: "결제·환불" },
          { href: "/revenue", label: "매출 집계" },
        ]
      : [];
  const accountMenuItems =
    principal.role === "SUPER_ADMIN" ? [{ href: "/accounts", label: "계정 관리" }] : [];

  return [...OPERATIONAL_NAV_ITEMS, ...adminMenuItems, ...accountMenuItems, { href: "/account/password", label: "비밀번호 변경" }];
}

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const principal = await requireCurrentPrincipal();
  const displayName = principal.name || principal.email;
  const pendingApplicationCount =
    principal.role === "ADMIN" || principal.role === "SUPER_ADMIN"
      ? await countPendingReservationApplications().catch(() => null)
      : 0;
  const navigationItems = getNavigationItems(principal, pendingApplicationCount);

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
