import { defineSite } from "./define";

/** Everything a tab, a search result, an install and a link preview say about bastion. */
export const SITE = defineSite({
  name: "bastion",
  title: "bastion — eight products, operated live, one receipt",
  description:
    "Operate all eight muizz-lab products live, chain them into one dossier sealed in a signed envelope, and verify every receipt yourself.",
  url: "https://bastion-six.vercel.app",
  accent: "#a78bfa",
  keywords: [
    "verifiable receipts",
    "signed evidence",
    "fact-checking",
    "audit log",
    "API gateway",
    "Next.js",
  ],
  card: {
    comment: "8 products · 1 signed receipt",
    headline: "tools that hand you a receipt.",
    highlight: "receipt",
  },
  // No sign-in (spec 21 §2): every page is public; robots.txt blocks only machine endpoints. The
  // sitemap lists each public page once (spec 20); the workbenches follow the registry's order.
  routes: {
    sitemap: [
      "/",
      "/tools",
      "/tools/bastion",
      "/tools/feathers",
      "/tools/inkgrid",
      "/tools/inkthread",
      "/tools/inkprint",
      "/tools/magpie",
      "/tools/paper-trail",
      "/tools/slowquery",
      "/dossier",
      "/audit",
      "/time-travel",
      "/platform",
    ],
    disallow: ["/api/"],
  },
});
