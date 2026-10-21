import "server-only";
import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactElement, ReactNode } from "react";
import { PageFrame } from "@/components/terminal/PageFrame";
import { WakeGate } from "@/components/tools/WakeGate";
import { SITE } from "@/lib/site/config";
import { pageMetadata } from "@/lib/site/metadata";
import { PRODUCTS, type Product, type ProductId } from "@/platform/registry/products";
import { BudgetProvider } from "../BudgetProvider";
import { loadBudgets } from "../load";
import { WorkbenchHeader } from "./WorkbenchHeader";

/**
 * The shell of `/tools/<product>` (spec 21 §5.1): rendered per request with today's budgets, the
 * header, and the wake gate around the product's workbench. Each product's page module passes its
 * own workbench in, so a page ships only that workbench's code (Ruling AH).
 */

type Search = Promise<Record<string, string | string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A workbench is titled and described from its registry entry alone (the metadata never reads the
 * network), and names itself as canonical.
 */
export function workbenchMetadata(id: ProductId): Metadata {
  return pageMetadata(SITE, `/tools/${id}`, {
    title: `${id} workbench`,
    description: `${productOf(id).tagline} Operate it live in bastion and keep what it hands back.`,
  });
}

function productOf(id: ProductId): Product {
  const product = PRODUCTS.find((p) => p.id === id);
  if (product === undefined) throw new Error(`tools: the registry has no ${id}`);
  return product;
}

/**
 * `render` draws the workbench, given the document a link named (`?doc=`, a UUID) or null. A plain
 * async function the page awaits, so the page stays one awaitable server render.
 */
export async function workbenchPage(
  id: ProductId,
  searchParams: Search,
  render: (doc: string | null) => ReactNode,
): Promise<ReactElement> {
  const product = productOf(id);

  await connection();
  const [budgets, search] = await Promise.all([loadBudgets(), searchParams]);
  // The inkgrid ↔ inkthread hand-off: one UUID, or nothing.
  const doc = typeof search.doc === "string" && UUID.test(search.doc) ? search.doc : null;

  return (
    <PageFrame
      active="tools"
      statusLeft={`workbench · ${product.id}`}
      statusRight={
        product.services.length === 0 ? "runs inside bastion" : product.services.join(" · ")
      }
    >
      <div className="space-y-10">
        <WorkbenchHeader product={product} />
        <BudgetProvider initial={budgets}>
          <WakeGate name={product.name} services={product.services}>
            {render(doc)}
          </WakeGate>
        </BudgetProvider>
      </div>
    </PageFrame>
  );
}
