import { BastionWorkbench } from "@/features/tools/bastion/BastionWorkbench";
import { workbenchMetadata, workbenchPage } from "@/features/tools/components/WorkbenchPage";

/** `/tools/bastion` (spec 21 §5): bastion's workbench — this route ships only its code (Ruling AH). */

export const metadata = workbenchMetadata("bastion");

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return workbenchPage("bastion", searchParams, () => <BastionWorkbench />);
}
