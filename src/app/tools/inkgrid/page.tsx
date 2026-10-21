import { workbenchMetadata, workbenchPage } from "@/features/tools/components/WorkbenchPage";
import { InkgridWorkbench } from "@/features/tools/inkgrid/InkgridWorkbench";

/** `/tools/inkgrid` (spec 21 §5): inkgrid's workbench — this route ships only its code (Ruling AH). */

export const metadata = workbenchMetadata("inkgrid");

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return workbenchPage("inkgrid", searchParams, (doc) => <InkgridWorkbench doc={doc} />);
}
