import type { NextConfig } from "next";
import { legacyRedirects } from "./src/platform/legacy-redirects";
import { PRODUCTS } from "./src/platform/registry/products";
import { securityHeaders } from "./src/platform/security-headers";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: [...securityHeaders(process.env.NODE_ENV)] }];
  },
  // v1's /dashboard and /services/<id> keep working (spec 21 §3.2).
  async redirects() {
    return legacyRedirects(PRODUCTS.map((p) => p.id));
  },
};

export default nextConfig;
