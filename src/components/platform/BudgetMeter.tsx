/**
 * Today's remaining budget for a limited action (spec 21 §4): a role="meter" whose value is written
 * out; the cells only illustrate it. Budgets reset at 00:00 UTC.
 */

export const MAX_CELLS = 20;

type Level = "ok" | "low" | "empty" | "off";

const LEVEL_CELL: Readonly<Record<Level, string>> = {
  ok: "bg-accent-violet",
  low: "bg-warning",
  empty: "bg-error",
  off: "bg-fg-faint",
};

const LEVEL_TEXT: Readonly<Record<Level, string>> = {
  ok: "text-foreground",
  low: "text-warning",
  empty: "text-error",
  off: "text-fg-muted",
};

function assertCount(name: string, n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`BudgetMeter: ${name} must be a non-negative whole number, not ${n}`);
  }
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function BudgetMeter({
  label,
  left,
  limit,
  id,
  className = "",
}: {
  label: string;
  left: number;
  limit: number;
  id?: string;
  className?: string;
}) {
  assertCount("limit", limit);
  assertCount("left", left);
  if (left > limit) throw new RangeError(`BudgetMeter: left (${left}) exceeds limit (${limit})`);

  const labelId = id ?? `budget-${slug(label)}`;
  const level: Level =
    limit === 0 ? "off" : left === 0 ? "empty" : left * 4 <= limit ? "low" : "ok";
  const cells = Math.min(limit, MAX_CELLS);
  // Never an empty bar while something is left.
  const full = left === 0 ? 0 : Math.max(1, Math.round((left / limit) * cells));
  const valueText =
    level === "off"
      ? "off today"
      : left === 0
        ? `none of ${limit} left today`
        : `${left} of ${limit} left today`;

  return (
    <div data-level={level} className={`font-mono text-xs ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="text-fg-muted">
          {label}
        </span>
        <span className={`tabular-nums ${LEVEL_TEXT[level]}`}>
          {level === "off"
            ? "off today"
            : left === 0
              ? "none left — resets 00:00 UTC"
              : `${left} of ${limit}`}
        </span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot draw the segmented cells */}
      <div
        role="meter"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={left}
        aria-valuetext={valueText}
        className="mt-1.5 flex h-2 gap-[3px]"
      >
        {Array.from({ length: level === "off" ? 0 : cells }, (_, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional and never reorder
            key={i}
            data-cell={i < full ? "full" : "empty"}
            className={`h-full flex-1 rounded-[1px] ${i < full ? LEVEL_CELL[level] : "bg-border-bright"}`}
          />
        ))}
      </div>
    </div>
  );
}
