import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // rbac.ts guards pages with forbidden()/unauthorized() from next/navigation;
  // without this flag those calls throw a server error instead of rendering
  // the styled forbidden.tsx / unauthorized.tsx interrupt pages.
  experimental: {
    authInterrupts: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' https://fonts.gstatic.com",
              "connect-src 'self' https://*.onrender.com https://*.vercel.app https://*.upstash.io",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
