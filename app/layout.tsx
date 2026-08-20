import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YAHO 관리",
  description: "YAHO 운영 관리 시스템",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
