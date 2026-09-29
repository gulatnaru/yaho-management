import type { Metadata } from "next";

// 비로그인 보호자용 화면(ADR-052). 관리자 레이아웃·네비게이션·인증을 쓰지 않는다.
// 신청 링크가 검색엔진에 색인되거나 Referer 로 외부에 전달되지 않게 한다.
export const metadata: Metadata = {
  title: "YAHO 예약 신청",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-xl px-4 py-4 font-semibold">YAHO</div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-6">{children}</main>
    </div>
  );
}
