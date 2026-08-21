"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface NavDrawerItem {
  href: string;
  label: string;
}

export interface NavDrawerProps {
  items: NavDrawerItem[];
  userLabel: string;
  children: React.ReactNode;
}

/**
 * md(768px) 이상: 상단 가로 네비게이션.
 * md 미만: 햄버거 버튼 + 좌측 드로어.
 * docs/UI-GUIDELINES.md #2, ADR-017 참고.
 */
export function NavDrawer({ items, userLabel, children }: NavDrawerProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 768px)");

    function handleChange(event: MediaQueryListEvent) {
      if (event.matches) {
        setOpen(false);
      }
    }

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return (
    <>
      {/* 모바일(md 미만): 햄버거 버튼 */}
      <button
        aria-controls="mobile-nav-drawer"
        aria-expanded={open}
        aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
        className="text-slate-600 md:hidden"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        {open ? <X aria-hidden="true" className="h-6 w-6" /> : <Menu aria-hidden="true" className="h-6 w-6" />}
      </button>

      {children}

      {/* 데스크톱(md 이상): 상단 가로 네비게이션 */}
      <nav className="hidden items-center gap-4 text-sm md:flex">
        {items.map((item) => (
          <Link className="text-slate-600 hover:underline" href={item.href} key={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>

      {/* 모바일 전용 오버레이 + 드로어 패널 */}
      <div
        aria-hidden={!open}
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setOpen(false)}
      />
      <div
        aria-hidden={!open}
        aria-label="사이드 메뉴"
        aria-modal="true"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col justify-between bg-white p-6 shadow-lg transition-transform duration-200 ease-in-out md:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        id="mobile-nav-drawer"
        role="dialog"
      >
        <nav className="flex flex-col gap-4 text-sm">
          {items.map((item) => (
            <Link
              className="text-slate-600 hover:underline"
              href={item.href}
              key={item.href}
              onClick={() => setOpen(false)}
              tabIndex={open ? undefined : -1}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-slate-600">{userLabel}</p>
      </div>
    </>
  );
}
