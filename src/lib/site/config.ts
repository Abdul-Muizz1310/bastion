import { defineSite } from "./define";

/** Everything a tab, a search result, an install and a link preview say about bastion. */
export const SITE = defineSite({
  name: "bastion",
  title: "bastion — control plane, identity and audit",
  description:
    "A Next.js control plane for the muizz-lab services: magic-link sign-in, role-based access, an API gateway, and an append-only audit log you can time-travel.",
  url: "https://bastion-six.vercel.app",
  accent: "#a78bfa",
  keywords: ["control plane", "RBAC", "audit log", "API gateway", "magic link", "Next.js"],
  card: {
    comment: "control plane · identity · audit",
    headline: "one gateway, every call audited.",
    highlight: "audited",
  },
  // Every page but /login needs a session and redirects there; robots.txt blocks only machine endpoints.
  routes: { sitemap: ["/login"], disallow: ["/api/", "/auth/"] },
});
