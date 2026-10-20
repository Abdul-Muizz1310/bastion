import type { ReceiptStamp } from "@/components/receipts/ReceiptCard";

/**
 * A workbench receipt as plain text — what its copy button puts on the clipboard (spec 21 §5.1):
 * the kind and serial, the subject, the stamp, every line, any extra lines (full hashes the card
 * truncates), and the request id with the path of its audit trail. Pure.
 */

export type TextLine = { label: string; value: string };

export type ReceiptTextInput = {
  kind: string;
  serial?: string;
  title: string;
  stamp?: ReceiptStamp;
  lines: readonly TextLine[];
  extra?: readonly string[];
  requestId: string;
};

export function auditPath(requestId: string): string {
  return `/audit/${encodeURIComponent(requestId)}`;
}

export function receiptText(r: ReceiptTextInput): string {
  return [
    r.serial ? `${r.kind} #${r.serial}` : r.kind,
    r.title,
    ...(r.stamp ? [`[${r.stamp.text}]`] : []),
    ...r.lines.map((l) => `${l.label}: ${l.value}`),
    ...(r.extra ?? []),
    `request: ${r.requestId}`,
    `audit: ${auditPath(r.requestId)}`,
  ].join("\n");
}
