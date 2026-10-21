"use client";

import { useId } from "react";
import type { InkthreadDocument } from "@/capabilities/inkthread";
import { INPUT, LABEL } from "@/components/tools/styles";
import { plural } from "../format";

/**
 * The document both inkgrid's and inkthread's workbenches read: one of inkthread's curated samples,
 * or the document a link named (`?doc=`, e.g. an upload read on the inkgrid page).
 */

export function docLabel(d: Pick<InkthreadDocument, "title" | "file_name" | "page_count">): string {
  const name = d.title?.split("\n")[0] ?? d.file_name ?? "untitled";
  return `${name} · ${plural(d.page_count, "page")}`;
}

export function SamplePicker({
  samples,
  value,
  onChange,
  disabled,
}: {
  samples: readonly InkthreadDocument[];
  value: string | null;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  const known = value === null || samples.some((s) => s.id === value);
  return (
    <div className="min-w-0 flex-1 space-y-1.5 sm:min-w-64">
      <label htmlFor={id} className={LABEL}>
        document
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={INPUT}
      >
        {value === null ? <option value="">choose a document…</option> : null}
        {known ? null : (
          <option value={value}>the document from the link ({value.slice(0, 8)})</option>
        )}
        {samples.map((s) => (
          <option key={s.id} value={s.id}>
            {docLabel(s)}
            {s.stats ? ` · ${s.stats.nodes} nodes` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
