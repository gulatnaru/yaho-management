import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() { return [{ source: "/invite/:path*", headers: [
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Cache-Control", value: "no-store" },
    { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  ] }]; },
};

export default nextConfig;
