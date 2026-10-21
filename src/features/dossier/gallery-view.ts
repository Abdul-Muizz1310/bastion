import type { ReceiptLine, ReceiptStamp, ReceiptTone } from "@/components/receipts/ReceiptCard";
import type { PublicDossier } from "@/dossier/gallery";

/**
 * The home gallery as a view (spec 21 §3.1): which public dossiers it shows and how each one reads as
 * a receipt. Pure — the page's loader does the reading.
 */

export const GALLERY_SIZE = 6;

/** The most recent succeeded dossiers, in the order given (newest first), at most `size`. */
export function galleryItems(
  dossiers: readonly PublicDossier[],
  size: number = GALLERY_SIZE,
): PublicDossier[] {
  return dossiers.filter((d) => d.status === "succeeded").slice(0, size);
}

export type DossierReceipt = {
  kind: "dossier";
  serial: string;
  title: string;
  href: string;
  stamp?: ReceiptStamp;
  lines: ReceiptLine[];
  footer: string;
};

const VERDICT_TONE: Readonly<Record<NonNullable<PublicDossier["verdict"]>, ReceiptTone>> = {
  TRUE: "pass",
  FALSE: "fail",
  INCONCLUSIVE: "neutral",
};

const WHEN = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function verdictLine(d: PublicDossier): string {
  if (d.verdict === null) return "none";
  const word = d.verdict.toLowerCase();
  if (d.confidence === null) return word;
  const pct = Math.round(Math.min(1, Math.max(0, d.confidence)) * 100);
  return `${word} · ${pct}% confidence`;
}

export function dossierReceipt(d: PublicDossier): DossierReceipt {
  const created = new Date(d.createdAt);
  if (Number.isNaN(created.getTime())) {
    throw new RangeError(`dossierReceipt: ${d.id} has an unreadable createdAt "${d.createdAt}"`);
  }
  return {
    kind: "dossier",
    serial: d.id.slice(0, 8),
    title: d.claim,
    href: `/d/${d.id}`,
    ...(d.verdict === null
      ? {}
      : { stamp: { text: d.verdict.toLowerCase(), tone: VERDICT_TONE[d.verdict] } }),
    lines: [
      { label: "verdict", value: verdictLine(d) },
      { label: "evidence", value: plural(d.evidenceCount, "item", "items") },
      {
        label: "documents",
        value: d.documentCount === 0 ? "none" : plural(d.documentCount, "PDF", "PDFs"),
      },
      {
        label: "products",
        value: d.products.length > 0 ? d.products.join(" · ") : "none recorded",
      },
      { label: "mode", value: d.mode },
    ],
    footer: `${WHEN.format(created)} UTC`,
  };
}
