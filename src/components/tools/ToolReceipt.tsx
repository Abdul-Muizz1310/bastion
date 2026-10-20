import { ReceiptCard, type ReceiptStamp } from "@/components/receipts/ReceiptCard";
import { AuditLink } from "./AuditLink";
import { CopyButton } from "./CopyButton";
import { receiptText, type TextLine } from "./receipt-text";

/**
 * The receipt every workbench result shows (spec 21 §5.1 invariant 3): the receipt card, its request
 * id linking to the call's audit trail, and a copy button that copies it as plain text — including
 * the full values the card truncates.
 */
export function ToolReceipt({
  kind,
  serial,
  title,
  lines,
  stamp,
  extra,
  requestId,
  headingLevel = 3,
  className = "",
}: {
  kind: string;
  serial?: string;
  title: string;
  lines: readonly TextLine[];
  stamp?: ReceiptStamp;
  extra?: readonly string[];
  requestId: string;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}) {
  const text = receiptText({ kind, serial, title, stamp, lines, extra, requestId });
  return (
    <ReceiptCard
      kind={kind}
      serial={serial}
      title={title}
      stamp={stamp}
      headingLevel={headingLevel}
      className={className}
      lines={lines.map((l) => ({
        label: l.label,
        value: (
          <span title={l.value} translate="no">
            {l.value}
          </span>
        ),
      }))}
      footer={
        <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <AuditLink requestId={requestId} />
          <CopyButton text={text} label={`the ${kind} receipt`} />
        </span>
      }
    />
  );
}
