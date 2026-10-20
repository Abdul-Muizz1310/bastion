/**
 * How the audit pages write times and ids (spec 21 §3.2): always UTC, to the millisecond, the same
 * on the server and in the browser (no locale clock, so no hydration drift). Pure.
 */

const DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function assertDate(d: Date): void {
  if (Number.isNaN(d.getTime())) throw new RangeError("audit format: an invalid date");
}

/** "20 Oct 2026". */
export function utcDay(d: Date): string {
  assertDate(d);
  return DAY.format(d);
}

/** "18:13:26.282" (or "18:13:26" without milliseconds). */
export function utcTime(d: Date, millis = true): string {
  assertDate(d);
  return d.toISOString().slice(11, millis ? 23 : 19);
}

/** An event id as a receipt serial: "#000123". */
export function serial(id: number): string {
  return `#${String(id).padStart(6, "0")}`;
}

/** The first 8 characters of a request id, as the pages name it. */
export function shortRequest(requestId: string): string {
  return requestId.slice(0, 8);
}
