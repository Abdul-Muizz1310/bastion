"use client";

import { useCallback, useState } from "react";
import { aspectMismatch, type Bbox, type PageSize, pageImagePath, regionRect } from "./page-boxes";

/**
 * A PDF page with an element's boxes drawn on it (spec 21 §5, §5.1 invariant 7): inkthread's
 * rendered page (`inkthread.page`, through the gateway) at the page's aspect ratio, and over it an
 * SVG whose viewBox is the page in PDF points — the coordinate system inkthread's bboxes use — so
 * the boxes scale with the image at any width. A box that cannot be drawn honestly is left out,
 * and when the render is not the page's shape (a rotated page) no box is drawn at all.
 */

export type PageBox = { key: string; bbox: Bbox; tone: "self" | "related" };

const TONE_CLASS: Readonly<Record<PageBox["tone"], string>> = {
  self: "fill-accent-violet/15 stroke-accent-violet",
  related: "fill-accent-cyan/10 stroke-accent-cyan [stroke-dasharray:6_4]",
};

export function PageWithBoxes({
  documentId,
  page,
  size,
  boxes,
  label,
  imageSize,
}: {
  documentId: string;
  page: number;
  size: PageSize;
  boxes: readonly PageBox[];
  /** What the boxes mark, for the image's description. */
  label: string;
  /** The image's natural size once it has loaded (tests seed it). */
  imageSize?: { width: number; height: number };
}) {
  const src = pageImagePath(documentId, page);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [measured, setMeasured] = useState(imageSize ?? null);
  const measure = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) {
      setMeasured({ width: img.naturalWidth, height: img.naturalHeight });
    }
  }, []);
  const rotated = measured !== null && aspectMismatch(measured, size);
  const drawn = rotated
    ? []
    : boxes.flatMap((box) => {
        const rect = regionRect(box.bbox, size);
        return rect === null ? [] : [{ ...box, rect }];
      });

  return (
    <figure className="space-y-2">
      <div
        className="relative w-full overflow-hidden rounded-[3px] border border-border-bright bg-[#f4f3ee]"
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
      >
        {failedSrc === src ? (
          <p className="absolute inset-0 flex items-center justify-center bg-surface p-6 text-center font-mono text-xs text-fg-muted">
            the page image did not load — inkthread may be asleep, or an upload’s pages are gone
            (they are kept for an hour). The boxes are still drawn to scale.
          </p>
        ) : (
          // biome-ignore lint/performance/noImgElement: a gateway-served PNG at the page's own size, not an optimisable asset
          <img
            src={src}
            alt={`page ${page} of the document, with ${label} boxed`}
            width={Math.round(size.width)}
            height={Math.round(size.height)}
            loading="lazy"
            decoding="async"
            ref={measure}
            onLoad={(e) => measure(e.currentTarget)}
            onError={() => setFailedSrc(src)}
            className="absolute inset-0 block h-full w-full select-none"
            draggable={false}
          />
        )}
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${size.width} ${size.height}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {drawn.map((box) => (
            <rect
              key={box.key}
              data-box={box.tone}
              x={box.rect.x}
              y={box.rect.y}
              width={box.rect.width}
              height={box.rect.height}
              rx={2}
              vectorEffect="non-scaling-stroke"
              strokeWidth={2}
              className={TONE_CLASS[box.tone]}
            />
          ))}
        </svg>
      </div>
      <figcaption className="font-mono text-[11px] text-fg-muted">
        {rotated && measured ? (
          <span className="text-warning">
            page {page} is rotated in the PDF: its render is {measured.width} × {measured.height} px
            while the page is {size.width} × {size.height} pt, so its boxes would land in the wrong
            place — they are not drawn.
          </span>
        ) : (
          <>
            page {page} · {drawn.length} {drawn.length === 1 ? "box" : "boxes"} in PDF points
            (top-left origin), drawn over inkthread’s render
          </>
        )}
      </figcaption>
    </figure>
  );
}
