import { z } from "zod";

/** The product registry (spec 21 §5): what exists, what it hands back, and where it runs. */

export type ServiceId =
  | "paper-trail"
  | "magpie"
  | "inkprint"
  | "inkthread"
  | "slowquery"
  | "feathers-demo";

export type ProductId =
  | "bastion"
  | "feathers"
  | "inkgrid"
  | "inkthread"
  | "inkprint"
  | "magpie"
  | "paper-trail"
  | "slowquery";

export type RepoRef = { name: string; url: string };

export type Product = {
  id: ProductId;
  name: string;
  tagline: string;
  /** What the product hands back — the artefact a visitor can keep. */
  receipt: string;
  repos: RepoRef[];
  services: ServiceId[];
  frontendUrl?: string;
  packages: { name: string; url: string }[];
};

export type Service = {
  id: ServiceId;
  baseUrl: string;
  healthPath: "/health";
  versionPath: "/version";
};

const GITHUB_OWNER = "https://github.com/Abdul-Muizz1310";
const repo = (name: string): RepoRef => ({ name, url: `${GITHUB_OWNER}/${name}` });
const pypi = (name: string) => ({ name, url: `https://pypi.org/project/${name}/` });

export const PRODUCTS: readonly Product[] = [
  {
    id: "bastion",
    name: "bastion",
    tagline: "The control plane: a workbench, a dossier and an append-only audit.",
    receipt: "An append-only audit trail of everything the platform did for you.",
    repos: [repo("bastion")],
    services: [],
    frontendUrl: "https://bastion-six.vercel.app",
    packages: [],
  },
  {
    id: "feathers",
    name: "feathers",
    tagline: "Scaffolds production FastAPI services from a YAML schema.",
    receipt: "A byte-identical no-op rerun.",
    repos: [repo("feathers"), repo("feathers-demo")],
    services: ["feathers-demo"],
    packages: [pypi("feathers-cli")],
  },
  {
    id: "inkgrid",
    name: "inkgrid",
    tagline: "Exact PDF tables and text from the text layer, verified by a second PDF engine.",
    receipt: "The verification report.",
    repos: [repo("inkgrid")],
    // inkthread serves inkgrid's readings.
    services: ["inkthread"],
    packages: [pypi("inkgrid")],
  },
  {
    id: "inkthread",
    name: "inkthread",
    tagline: "A PDF as a knowledge graph of its own parts.",
    receipt: "graph_hash and the why of every element.",
    repos: [repo("inkthread-backend"), repo("inkthread-frontend")],
    services: ["inkthread"],
    frontendUrl: "https://inkthread-frontend.vercel.app",
    packages: [],
  },
  {
    id: "inkprint",
    name: "inkprint",
    tagline: "Signed authorship certificates, dual fingerprint, leak scan. BUSL-1.1.",
    receipt: "An Ed25519-signed, C2PA-aligned certificate.",
    repos: [repo("inkprint-backend"), repo("inkprint-frontend")],
    services: ["inkprint"],
    frontendUrl: "https://inkprint-frontend.vercel.app",
    packages: [],
  },
  {
    id: "magpie",
    name: "magpie",
    tagline: "YAML scrapers that self-heal broken selectors and open a reviewed PR.",
    receipt: "A diffable, human-approved PR.",
    repos: [repo("magpie-backend"), repo("magpie-frontend")],
    services: ["magpie"],
    frontendUrl: "https://magpie-frontend-three.vercel.app",
    packages: [],
  },
  {
    id: "paper-trail",
    name: "paper-trail",
    tagline: "An adversarial Proponent, Skeptic and Judge debate that fact-checks a claim.",
    receipt: "The signed transcript.",
    repos: [repo("paper-trail-backend"), repo("paper-trail-frontend")],
    services: ["paper-trail"],
    frontendUrl: "https://paper-trail-frontend-sable.vercel.app",
    packages: [],
  },
  {
    id: "slowquery",
    name: "slowquery",
    tagline: "Catches slow Postgres queries and hands you the exact index.",
    receipt: "The EXPLAIN plan and the CREATE INDEX.",
    repos: [
      repo("slowquery-detective"),
      repo("slowquery-demo-backend"),
      repo("slowquery-dashboard-frontend"),
    ],
    services: ["slowquery"],
    frontendUrl: "https://slowquery-dashboard-frontend.vercel.app",
    packages: [pypi("slowquery-detective")],
  },
];

const httpsUrl = z.url().refine((u) => u.startsWith("https://"), "must be an https URL");

/** Default in code; `<SERVICE>_BACKEND_URL` may override it, and must parse as https. */
function baseUrl(id: ServiceId, fallback: string): string {
  const envName = `${id.toUpperCase().replaceAll("-", "_")}_BACKEND_URL`;
  const raw = process.env[envName];
  const parsed = httpsUrl.safeParse(raw ?? fallback);
  if (!parsed.success) throw new Error(`${envName} must be an https URL`);
  return parsed.data.replace(/\/+$/, "");
}

function service(id: ServiceId, fallback: string): Service {
  return { id, baseUrl: baseUrl(id, fallback), healthPath: "/health", versionPath: "/version" };
}

export const SERVICES: Readonly<Record<ServiceId, Service>> = {
  "paper-trail": service("paper-trail", "https://paper-trail-backend-jjpf.onrender.com"),
  magpie: service("magpie", "https://magpie-backend-t4bb.onrender.com"),
  inkprint: service("inkprint", "https://inkprint-backend.onrender.com"),
  inkthread: service("inkthread", "https://inkthread-backend.onrender.com"),
  slowquery: service("slowquery", "https://slowquery-demo-backend.onrender.com"),
  "feathers-demo": service("feathers-demo", "https://feathers-demo-rznj.onrender.com"),
};

export function isServiceId(value: string): value is ServiceId {
  return Object.hasOwn(SERVICES, value);
}
