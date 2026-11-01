import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: { incomingRequests: false },
  async headers() { return [{ source: "/invite/:path*", headers: [
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Cache-Control", value: "no-store" },
    { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  ] }, { source: "/first-super-admin-ops/:path*", headers: [
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Cache-Control", value: "no-store" },
    { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  ] }]; },
};

export default nextConfig;
