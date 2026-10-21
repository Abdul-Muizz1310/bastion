import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as bastionImage from "@/app/tools/bastion/opengraph-image";
import * as feathersImage from "@/app/tools/feathers/opengraph-image";
import * as inkgridImage from "@/app/tools/inkgrid/opengraph-image";
import * as inkprintImage from "@/app/tools/inkprint/opengraph-image";
import * as inkthreadImage from "@/app/tools/inkthread/opengraph-image";
import * as magpieImage from "@/app/tools/magpie/opengraph-image";
import * as paperTrailImage from "@/app/tools/paper-trail/opengraph-image";
import * as slowqueryImage from "@/app/tools/slowquery/opengraph-image";
import { WORKBENCH_ORDER } from "@/features/tools/catalog";
import { PRODUCT_ACCENTS, workbenchCard, workbenchSite } from "@/features/tools/workbench-card";
import { SITE } from "@/lib/site/config";
import { SHARE_CARD_SIZE, ShareCard, headlineSize } from "@/lib/site/share-card";
import type { ProductId } from "@/platform/registry/products";

/** Spec 20, amendment "search" (case 16): each workbench previews with its own card. */

type ImageModule = { alt: string; size: typeof SHARE_CARD_SIZE; contentType: string };

const IMAGES: Record<ProductId, ImageModule> = {
  bastion: bastionImage,
  feathers: feathersImage,
  inkgrid: inkgridImage,
  inkthread: inkthreadImage,
  inkprint: inkprintImage,
  magpie: magpieImage,
  "paper-trail": paperTrailImage,
  slowquery: slowqueryImage,
};

describe("20-site: workbench share cards (case 16)", () => {
  it("takes each product's accent from its own frontend, or a hue no other product uses", () => {
    expect(PRODUCT_ACCENTS).toEqual({
      bastion: "#a78bfa",
      feathers: "#60a5fa",
      inkgrid: "#a3e635",
      inkthread: "#e879f9",
      inkprint: "#e0b55e",
      magpie: "#34d399",
      "paper-trail": "#22d3ee",
      slowquery: "#f97316",
    });
  });

  it("gives every product a different accent", () => {
    const accents = Object.values(PRODUCT_ACCENTS);
    expect(new Set(accents).size).toBe(WORKBENCH_ORDER.length);
  });

  it.each(WORKBENCH_ORDER)("draws the %s card as bastion's, in the product's accent", (id) => {
    const site = workbenchSite(id);
    expect(site.name).toBe("bastion");
    expect(site.origin.href).toBe(SITE.origin.href);
    expect(site.accent).toBe(PRODUCT_ACCENTS[id]);
    expect(site.card).toEqual({
      comment: `workbench · ${id}`,
      headline: `operate ${id} live, keep the receipt.`,
      highlight: id,
    });
  });

  it.each(WORKBENCH_ORDER)("sets the %s headline large enough to read as a thumbnail", (id) => {
    expect(headlineSize(workbenchSite(id).card.headline)).toBeGreaterThanOrEqual(64);
  });

  it("highlights the product's name in its accent", () => {
    const html = renderToStaticMarkup(
      <ShareCard site={workbenchSite("magpie")} icon="data:image/svg+xml;base64," />,
    );
    expect(html).toContain("// workbench · magpie");
    expect(html).toMatch(/<span style="color:#34d399;[^"]*">magpie<\/span>/);
  });

  it.each(WORKBENCH_ORDER)("exports the %s image's alt, size and type for Next", (id) => {
    expect(IMAGES[id]).toMatchObject({
      alt: `bastion — operate ${id} live, keep the receipt.`,
      size: SHARE_CARD_SIZE,
      contentType: "image/png",
    });
  });

  it("renders a card as a 1200×630 PNG", async () => {
    const response = await workbenchCard("magpie");
    expect(response.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });
});
