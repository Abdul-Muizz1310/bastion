import { workbenchMetadata, workbenchPage } from "@/features/tools/components/WorkbenchPage";
import { SlowqueryWorkbench } from "@/features/tools/slowquery/SlowqueryWorkbench";

/** `/tools/slowquery` (spec 21 §5): slowquery's workbench — this route ships only its code (Ruling AH). */

export const metadata = workbenchMetadata("slowquery");

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return workbenchPage("slowquery", searchParams, () => <SlowqueryWorkbench />);
}
