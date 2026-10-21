import { workbenchMetadata, workbenchPage } from "@/features/tools/components/WorkbenchPage";
import { FeathersWorkbench } from "@/features/tools/feathers/FeathersWorkbench";

/** `/tools/feathers` (spec 21 §5): feathers's workbench — this route ships only its code (Ruling AH). */

export const metadata = workbenchMetadata("feathers");

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return workbenchPage("feathers", searchParams, () => <FeathersWorkbench />);
}
