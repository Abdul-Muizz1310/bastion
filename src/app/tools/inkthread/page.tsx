import { workbenchMetadata, workbenchPage } from "@/features/tools/components/WorkbenchPage";
import { InkthreadWorkbench } from "@/features/tools/inkthread/InkthreadWorkbench";

/** `/tools/inkthread` (spec 21 §5): inkthread's workbench — this route ships only its code (Ruling AH). */

export const metadata = workbenchMetadata("inkthread");

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return workbenchPage("inkthread", searchParams, (doc) => <InkthreadWorkbench doc={doc} />);
}
