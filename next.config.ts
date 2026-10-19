import type { NextConfig } from "next";
import { securityHeaders } from "./src/platform/security-headers";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: [...securityHeaders(process.env.NODE_ENV)] }];
  },
};

export default nextConfig;
