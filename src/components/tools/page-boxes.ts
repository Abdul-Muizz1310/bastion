/**
 * Boxes on a rendered PDF page (spec 21 §5.1, invariant 7), the pure core of `PageWithBoxes`.
 *
 * inkthread's bboxes are `[x0, top, x1, bottom]` in PDF points with a top-left origin on the
 * unrotated page (inkthread spec 01 "pages", spec 11 "tables"), and the page's size is in the same
 * points. That is exactly the coordinate system of an SVG whose viewBox is `0 0 width height`, laid
 * over the page image at the page's aspect ratio — so a box scales with the image and needs no
 * conversion, only checking: clamped to the page, and not drawn when inverted, empty or not finite.
 */

export type Bbox = readonly [number, number, number, number];
export type PageSize = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Region = { page: number; bbox: Bbox };

function assertPage(page: PageSize): void {
  const ok = (n: number) => Number.isFinite(n) && n > 0;
  if (!ok(page.width) || !ok(page.height)) {
    throw new RangeError("page boxes: a page needs a positive, finite width and height");
  }
}

const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));

/** The box in page points, clamped to the page; null when there is nothing honest to draw. */
export function regionRect(bbox: Bbox, page: PageSize): Rect | null {
  assertPage(page);
  if (!bbox.every(Number.isFinite)) return null;
  const [x0, y0, x1, y1] = bbox;
  if (x1 <= x0 || y1 <= y0) return null;
  const left = clamp(x0, page.width);
  const top = clamp(y0, page.height);
  const right = clamp(x1, page.width);
  const bottom = clamp(y1, page.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function regionsOnPage<R extends Region>(regions: readonly R[], page: number): R[] {
  return regions.filter((r) => r.page === page);
}

/** The page image, through the gateway (`inkthread.page`, raw PNG). */
export function pageImagePath(documentId: string, page: number): string {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError("page boxes: a page number is a positive whole number");
  }
  const query = new URLSearchParams({ documentId, page: String(page) });
  return `/api/tools/inkthread.page?${query.toString()}`;
}
