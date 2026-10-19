/**
 * The response headers bastion sets on every route (docs/ARCHITECTURE.md invariant 10, DR-0018).
 * One list, read by both `next.config.ts` (`headers()`) and `src/proxy.ts`, so they cannot drift.
 *
 * The CSP is source-restricting, not inline-blocking: Next's hydration bootstrap is an inline
 * <script>, so 'unsafe-inline' has to stay until a nonce pipeline exists. 'unsafe-eval' is only
 * needed by the dev bundler's refresh runtime, so production drops it.
 */

export type SecurityHeader = { readonly key: string; readonly value: string };

export function securityHeaders(nodeEnv: string | undefined): readonly SecurityHeader[] {
  const isDev = nodeEnv !== "production";
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  return [
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
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
}
