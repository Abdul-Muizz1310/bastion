import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isProductId, WORKBENCH_ORDER, WORKBENCHES } from "@/features/tools/catalog";
import { PRODUCTS } from "@/platform/registry/products";

/**
 * Each workbench says what it operates and the receipt it shows exactly as spec 21 §5's table does
 * — the table is the content contract, so this test reads it.
 */

const SPEC = readFileSync(resolve(__dirname, "../../../../docs/specs/21-bastion-v2.md"), "utf8");

function specRows(): Map<string, { operate: string; receipt: string }> {
  const start = SPEC.indexOf("## 5. Workbenches");
  const table = SPEC.slice(start, SPEC.indexOf("### 5.1", start));
  const rows = new Map<string, { operate: string; receipt: string }>();
  for (const line of table.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    const [, product, operate, receipt] = cells;
    if (!product || !operate || !receipt || product === "Product" || product.startsWith("---")) continue;
    const plain = (s: string) => s.replaceAll("`", "");
    rows.set(product, { operate: plain(operate), receipt: plain(receipt) });
  }
  return rows;
}

describe("the workbench catalog", () => {
  it("has a workbench for every product, in dossier order with bastion last", () => {
    expect([...WORKBENCH_ORDER].sort()).toEqual(PRODUCTS.map((p) => p.id).sort());
    expect(WORKBENCH_ORDER.at(-1)).toBe("bastion");
  });

  it("says exactly what spec 21 §5 says each one operates and shows", () => {
    const rows = specRows();
    expect(rows.size).toBe(8);
    for (const id of WORKBENCH_ORDER) {
      expect(WORKBENCHES[id], id).toEqual(rows.get(id));
    }
  });

  it("knows a product id from anything else, prototype keys included", () => {
    expect(isProductId("inkthread")).toBe(true);
    expect(isProductId("inkthreads")).toBe(false);
    expect(isProductId("constructor")).toBe(false);
  });
});
