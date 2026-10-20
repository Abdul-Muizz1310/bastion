/**
 * Invariant 1 (spec 21 §5.1, review round 4): no action runs before its gate is live. A control
 * that can be `disabled` is, and points at `HELD_REASON`; a handler no attribute can hold — an SVG
 * node, a file picker's answer — checks the gate itself through `whenLive`.
 */

/** What every held action says (visible, and its control's description). */
export const HELD_REASON = "This unlocks once the wake above answers live.";

/** Runs `run` only while the gate is live; otherwise does nothing but call `onHeld`. */
export function whenLive<A extends unknown[]>(
  ready: boolean,
  run: (...args: A) => void,
  onHeld: () => void = () => {},
): (...args: A) => void {
  return (...args) => {
    if (ready) run(...args);
    else onHeld();
  };
}
