import type { ProductId } from "@/platform/registry/products";
import { BastionWorkbench } from "../bastion/BastionWorkbench";
import { FeathersWorkbench } from "../feathers/FeathersWorkbench";
import { InkgridWorkbench } from "../inkgrid/InkgridWorkbench";
import { InkprintWorkbench } from "../inkprint/InkprintWorkbench";
import { InkthreadWorkbench } from "../inkthread/InkthreadWorkbench";
import { MagpieWorkbench } from "../magpie/MagpieWorkbench";
import { PaperTrailWorkbench } from "../paper-trail/PaperTrailWorkbench";
import { SlowqueryWorkbench } from "../slowquery/SlowqueryWorkbench";

/** The workbench for one product; every product has exactly one (the switch is exhaustive). */
export function Workbench({ id, doc }: { id: ProductId; doc: string | null }) {
  switch (id) {
    case "magpie":
      return <MagpieWorkbench />;
    case "inkgrid":
      return <InkgridWorkbench doc={doc} />;
    case "inkthread":
      return <InkthreadWorkbench doc={doc} />;
    case "inkprint":
      return <InkprintWorkbench />;
    case "paper-trail":
      return <PaperTrailWorkbench />;
    case "slowquery":
      return <SlowqueryWorkbench />;
    case "feathers":
      return <FeathersWorkbench />;
    case "bastion":
      return <BastionWorkbench />;
    default:
      return assertNever(id);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`no workbench for ${String(value)}`);
}
