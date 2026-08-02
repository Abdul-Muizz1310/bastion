import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // rbac.ts guards pages with forbidden()/unauthorized() from next/navigation;
  // without this flag those calls throw a server error instead of rendering
  // the styled forbidden.tsx / unauthorized.tsx interrupt pages.
  experimental: {
    authInterrupts: true,
  },
  async headers() {
    // The CSP is source-restricting, not inline-blocking: Next's hydration
    // bootstrap is an inline <script>, so 'unsafe-inline' has to stay until a
    // nonce pipeline exists. 'unsafe-eval' is only needed by the dev bundler's
    // refresh runtime, so production drops it.
    const isDev = process.env.NODE_ENV !== "production";
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";

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
              scriptSrc,
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
