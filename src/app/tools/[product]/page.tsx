import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageFrame } from "@/components/terminal/PageFrame";
import { WakeGate } from "@/components/tools/WakeGate";
import { BudgetProvider } from "@/features/tools/BudgetProvider";
import { isProductId } from "@/features/tools/catalog";
import { Workbench } from "@/features/tools/components/Workbench";
import { WorkbenchHeader } from "@/features/tools/components/WorkbenchHeader";
import { loadBudgets } from "@/features/tools/load";
import { PRODUCTS } from "@/platform/registry/products";

/**
 * `/tools/[product]` (spec 21 §5, §5.1): one product, operated live. Rendered per request with
 * today's budgets; the workbench wakes the product's services and calls them through the gateway.
 */

type Props = {
  params: Promise<{ product: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The title comes from the route alone: it never reads the network.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ product: string }>;
}): Promise<Metadata> {
  const { product } = await params;
  return { title: isProductId(product) ? `${product} workbench` : "workbench not found" };
}

export default async function WorkbenchPage({ params, searchParams }: Props) {
  const { product: id } = await params;
  if (!isProductId(id)) notFound();
  const product = PRODUCTS.find((p) => p.id === id);
  if (product === undefined) notFound();

  await connection();
  const [budgets, search] = await Promise.all([loadBudgets(), searchParams]);
  // A document named by a link (the inkgrid ↔ inkthread hand-off): one UUID or nothing.
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
            <Workbench id={product.id} doc={doc} />
          </WakeGate>
        </BudgetProvider>
      </div>
    </PageFrame>
  );
}
