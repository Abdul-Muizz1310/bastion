import { workbenchMetadata, workbenchPage } from "@/features/tools/components/WorkbenchPage";
import { MagpieWorkbench } from "@/features/tools/magpie/MagpieWorkbench";

/** `/tools/magpie` (spec 21 §5): magpie's workbench — this route ships only its code (Ruling AH). */

export const metadata = workbenchMetadata("magpie");

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return workbenchPage("magpie", searchParams, () => <MagpieWorkbench />);
}
