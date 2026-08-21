import Link from "next/link";
import { requireAdmin } from "@/lib/auth/authorization";

const NAV_ITEMS = [{ href: "/children", label: "아이 관리" }];

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireAdmin();

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <p className="font-semibold">YAHO 관리</p>
          <nav className="flex items-center gap-4 text-sm">
            {NAV_ITEMS.map((item) => (
              <Link className="text-slate-600 hover:underline" href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
          <p className="text-sm text-slate-600">{session.user.name ?? session.user.email}</p>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
