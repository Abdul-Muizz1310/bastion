import { listPublicDossiers as listPublic } from "@/dossier/gallery";
import { budgetsLeft as readBudgets } from "@/platform/budget";
import type { GalleryState } from "../dossier/components/DossierGallery";
import { GALLERY_SIZE, galleryItems } from "../dossier/gallery-view";

/**
 * What the home page reads (spec 21 §3.1): the 6 most recent succeeded public dossiers, filtered in
 * SQL (Ruling AF) so the gallery fills whenever 6 exist, and today's debate budget, both at once.
 * Neither may take the landing page down: a database error marks the gallery unavailable, a
 * budget-store error hides the meter.
 */

export type HomeData = {
  gallery: GalleryState;
  debates: { left: number; limit: number } | null;
};

export type HomeDeps = {
  listPublicDossiers: typeof listPublic;
  budgetsLeft: typeof readBudgets;
};

const DEFAULT_DEPS: HomeDeps = { listPublicDossiers: listPublic, budgetsLeft: readBudgets };

export async function loadHome(deps: HomeDeps = DEFAULT_DEPS): Promise<HomeData> {
  const [gallery, debates] = await Promise.all([
    deps.listPublicDossiers(GALLERY_SIZE, { status: "succeeded" }).then(
      (dossiers): GalleryState => ({ kind: "ok", dossiers: galleryItems(dossiers) }),
      (err: unknown): GalleryState => {
        console.error("home: gallery unavailable", err);
        return { kind: "unavailable" };
      },
    ),
    deps.budgetsLeft().then(
      (budgets) => budgets.debate,
      (err: unknown) => {
        console.error("home: budget unavailable", err);
        return null;
      },
    ),
  ]);
  return { gallery, debates };
}
