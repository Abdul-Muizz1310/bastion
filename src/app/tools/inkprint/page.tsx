import { workbenchMetadata, workbenchPage } from "@/features/tools/components/WorkbenchPage";
import { InkprintWorkbench } from "@/features/tools/inkprint/InkprintWorkbench";

/** `/tools/inkprint` (spec 21 §5): inkprint's workbench — this route ships only its code (Ruling AH). */

export const metadata = workbenchMetadata("inkprint");

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return workbenchPage("inkprint", searchParams, () => <InkprintWorkbench />);
}
