import type { Metadata } from "next";
import { notFound } from "next/navigation";

/**
 * `/tools/[product]`: every workbench has its own static route (`/tools/magpie`, …), which wins
 * over this one, so whatever reaches here is not a product — a 404 (spec 21 §5.1).
 */

export async function generateMetadata(): Promise<Metadata> {
  return { title: "workbench not found" };
}

export default async function UnknownWorkbench({
  params,
}: {
  params: Promise<{ product: string }>;
}): Promise<never> {
  await params;
  notFound();
}
