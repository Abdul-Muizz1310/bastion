/**
 * A form's inline error, tied to its field with `aria-describedby`. Fields are checked when the
 * action runs (submits are never pre-disabled for a bad field), and the first bad one takes focus.
 */
export function FieldError({ id, message }: { id: string; message: string | null }) {
  return (
    <p id={id} aria-live="polite" className="font-mono text-[11px] text-warning empty:hidden">
      {message ?? ""}
    </p>
  );
}
