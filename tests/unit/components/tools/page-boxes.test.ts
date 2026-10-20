import { describe, expect, it } from "vitest";
import { pageImagePath, regionRect, regionsOnPage } from "@/components/tools/page-boxes";

/**
 * Boxes on a page (spec 21 §5.1, invariant 7). inkthread's bboxes are `[x0, top, x1, bottom]` in
 * PDF points with a top-left origin on the unrotated page (inkthread spec 01, 11) — the coordinate
 * system of an SVG whose viewBox is the page size, so a box needs no scaling, only checking.
 */

const LETTER = { width: 612, height: 792 };

describe("regionRect", () => {
  it("draws a box inside the page where inkthread put it", () => {
    expect(regionRect([50.39, 242.62, 579.64, 368.18], LETTER)).toEqual({
      x: 50.39,
      y: 242.62,
      width: 579.64 - 50.39,
      height: 368.18 - 242.62,
    });
  });

  it("is in the same units as the page, so it scales with the image: half the page is half", () => {
    const rect = regionRect([0, 0, 306, 396], LETTER);
    expect(rect && rect.width / LETTER.width).toBe(0.5);
    expect(rect && rect.height / LETTER.height).toBe(0.5);
  });

  it("clamps a box that runs off the page to the page", () => {
    expect(regionRect([-10, 700, 650, 900], LETTER)).toEqual({
      x: 0,
      y: 700,
      width: 612,
      height: 92,
    });
  });

  it.each([
    ["inverted horizontally", [300, 10, 100, 50]],
    ["inverted vertically", [10, 300, 50, 100]],
    ["of zero area", [10, 10, 10, 50]],
    ["wholly off the page", [700, 800, 900, 1000]],
    ["not finite", [Number.NaN, 0, 10, 10]],
    ["infinite", [0, 0, Number.POSITIVE_INFINITY, 10]],
  ] as const)("does not draw a box %s", (_name, bbox) => {
    expect(regionRect(bbox, LETTER)).toBeNull();
  });

  it("refuses a page without a positive size", () => {
    expect(() => regionRect([0, 0, 1, 1], { width: 0, height: 792 })).toThrow(RangeError);
    expect(() => regionRect([0, 0, 1, 1], { width: 612, height: Number.NaN })).toThrow(RangeError);
  });
});

describe("regionsOnPage", () => {
  it("keeps only the regions on the page shown", () => {
    const regions = [
      { page: 1, bbox: [1, 1, 2, 2] as const },
      { page: 10, bbox: [3, 3, 4, 4] as const },
      { page: 1, bbox: [5, 5, 6, 6] as const },
    ];
    expect(regionsOnPage(regions, 1).map((r) => r.bbox[0])).toEqual([1, 5]);
    expect(regionsOnPage(regions, 2)).toEqual([]);
  });
});

describe("pageImagePath", () => {
  it("asks the tools route for inkthread's rendered page", () => {
    expect(pageImagePath("d5152b39-8bbc-4141-ac06-9d5e70f98f99", 3)).toBe(
      "/api/tools/inkthread.page?documentId=d5152b39-8bbc-4141-ac06-9d5e70f98f99&page=3",
    );
  });

  it("refuses a page that is not a positive whole number", () => {
    expect(() => pageImagePath("d5152b39-8bbc-4141-ac06-9d5e70f98f99", 0)).toThrow(RangeError);
    expect(() => pageImagePath("d5152b39-8bbc-4141-ac06-9d5e70f98f99", 1.5)).toThrow(RangeError);
  });
});
