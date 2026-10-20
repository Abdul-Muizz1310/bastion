import { workbenchMetadata, workbenchPage } from "@/features/tools/components/WorkbenchPage";
import { PaperTrailWorkbench } from "@/features/tools/paper-trail/PaperTrailWorkbench";

/** `/tools/paper-trail` (spec 21 §5): paper-trail's workbench — this route ships only its code (Ruling AH). */

export const metadata = workbenchMetadata("paper-trail");

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return workbenchPage("paper-trail", searchParams, () => <PaperTrailWorkbench />);
}
