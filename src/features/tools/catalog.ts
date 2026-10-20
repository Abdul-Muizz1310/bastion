import type { ProductId } from "@/platform/registry/products";

/**
 * What each workbench operates and the receipt it shows — spec 21 §5's table, word for word (a test
 * reads the spec to keep them equal). The order is the dossier's: sources first, bastion last.
 */

export const WORKBENCH_ORDER: readonly ProductId[] = [
  "magpie",
  "inkgrid",
  "inkthread",
  "inkprint",
  "paper-trail",
  "slowquery",
  "feathers",
  "bastion",
];

export type WorkbenchRow = { operate: string; receipt: string };

export const WORKBENCHES: Readonly<Record<ProductId, WorkbenchRow>> = {
  magpie: {
    operate: "Pick a source, scrape once; browse items; heal history",
    receipt: "Item content hashes; self-heal PR links",
  },
  inkgrid: {
    operate: "Pick a sample PDF (or an upload): exact tables as cell grids, text, findings",
    receipt: "inkgrid's verification report (second-engine agreement)",
  },
  inkthread: {
    operate:
      'The same document as a graph (2D, colour by role), the "why" of any element, the page with the element\'s box drawn',
    receipt: "graph_hash; the rule or model behind each element",
  },
  inkprint: {
    operate: "Certify text, verify a certificate, diff against a parent, run a leak scan",
    receipt: "Certificate (signature, C2PA manifest), verify checks",
  },
  "paper-trail": {
    operate: "Debate a claim (budgeted), rounds appear as they finish",
    receipt: "Transcript hash and Ed25519 signature, checked live",
  },
  slowquery: {
    operate:
      "Fleet view: slowest fingerprints across the four services and the demo; the demo's slow/fast branch switch",
    receipt: "EXPLAIN plan and the exact CREATE INDEX",
  },
  feathers: {
    operate:
      "The YAML schema that generated feathers-demo; live CRUD on it (create, list, soft-delete, then a 404)",
    receipt: "The generated contract: role-gated endpoints, soft delete honoured",
  },
  bastion: {
    operate: "Token inspector (the decoded claims of the last call, never the token), JWKS",
    receipt: "The audit event for the call",
  },
};

export function isProductId(value: string): value is ProductId {
  return Object.hasOwn(WORKBENCHES, value);
}
