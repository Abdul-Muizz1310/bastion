import { useId } from "react";

/**
 * inkgrid's exact table as a cell grid (spec 21 §5, §5.1). inkgrid gives the rows dense — a merged
 * cell's text repeated at every position it covers — and how many leading rows are headers. Header
 * rows go in the table head as column headers, a run of one merged header cell drawn once across its
 * columns; every other row is data, exactly as read. The grid scrolls sideways inside a named,
 * keyboard-reachable region rather than the page.
 */

export type HeaderCell = { text: string; span: number; col: number };

/** A header row with each run of equal neighbours (one merged cell) drawn as one spanning cell. */
export function headerCells(row: readonly string[]): HeaderCell[] {
  const cells: HeaderCell[] = [];
  row.forEach((text, col) => {
    const last = cells.at(-1);
    if (last && last.text === text && text !== "") last.span += 1;
    else cells.push({ text, span: 1, col });
  });
  return cells;
}

export function TableGrid({
  rows,
  headerRows,
  caption,
}: {
  rows: readonly (readonly string[])[];
  headerRows: number;
  caption: string;
}) {
  if (!Number.isSafeInteger(headerRows) || headerRows < 0 || headerRows > rows.length) {
    throw new RangeError(`TableGrid: ${headerRows} header rows for a table of ${rows.length}`);
  }
  const captionId = `table-${useId()}`;
  const head = rows.slice(0, headerRows);
  const body = rows.slice(headerRows);

  return (
    // A named region (a <section> with a label), focusable so a keyboard can scroll it sideways.
    <section
      aria-labelledby={captionId}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must take focus to be scrolled by keyboard
      tabIndex={0}
      className="overflow-x-auto rounded-[3px] border border-border"
    >
      <table className="w-full min-w-max border-collapse font-mono text-xs">
        <caption
          id={captionId}
          className="border-b border-border bg-surface px-3 py-2 text-left text-[11px] uppercase tracking-[0.16em] text-fg-muted"
        >
          {caption}
        </caption>
        {head.length > 0 ? (
          <thead>
            {head.map((row, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and never reorder
              <tr key={r} className="bg-accent-violet-soft">
                {headerCells(row).map((cell) => (
                  <th
                    key={cell.col}
                    scope={cell.span > 1 ? "colgroup" : "col"}
                    colSpan={cell.span > 1 ? cell.span : undefined}
                    className="border border-border px-2.5 py-1.5 text-left align-bottom font-semibold text-accent-violet"
                  >
                    {cell.text}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
        ) : null}
        <tbody>
          {body.map((row, r) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and never reorder
            <tr key={r} className="odd:bg-surface/40">
              {row.map((text, c) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                  key={c}
                  className="max-w-[28rem] border border-border px-2.5 py-1.5 align-top text-foreground/90 tabular-nums"
                >
                  {text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
