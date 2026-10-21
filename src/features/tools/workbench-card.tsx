import { ImageResponse } from "next/og";
import { shareCardAssets } from "@/lib/site/assets";
import { SITE } from "@/lib/site/config";
import { defineSite, type HexColor, type Site } from "@/lib/site/define";
import { SHARE_CARD_SIZE, ShareCard, shareCardAlt } from "@/lib/site/share-card";
import type { ProductId } from "@/platform/registry/products";

/**
 * The share card of `/tools/<id>` (spec 20, amendment "search"): bastion's card, in the product's
 * accent, saying which workbench a link opens.
 */

/** Each product's own frontend's accent; feathers and inkgrid have none, so a hue no other uses. */
export const PRODUCT_ACCENTS: Readonly<Record<ProductId, HexColor>> = {
  bastion: "#a78bfa",
  feathers: "#60a5fa",
  inkgrid: "#a3e635",
  inkthread: "#e879f9",
  inkprint: "#e0b55e",
  magpie: "#34d399",
  "paper-trail": "#22d3ee",
  slowquery: "#f97316",
};

/** bastion's name, icon and host, with the product's accent and card copy; parsed like any site. */
export function workbenchSite(id: ProductId): Site {
  return defineSite({
    ...SITE,
    accent: PRODUCT_ACCENTS[id],
    card: {
      comment: `workbench · ${id}`,
      headline: `operate ${id} live, keep the receipt.`,
      highlight: id,
    },
  });
}

export function workbenchCardAlt(id: ProductId): string {
  return shareCardAlt(workbenchSite(id));
}

export async function workbenchCard(id: ProductId): Promise<ImageResponse> {
  const { fonts, icon } = await shareCardAssets();
  return new ImageResponse(<ShareCard site={workbenchSite(id)} icon={icon} />, {
    ...SHARE_CARD_SIZE,
    fonts,
  });
}
