"use client";

import { SvgDecoration } from "@/components/platform/SvgDecoration";
import { STATE_META, TONE_FILL } from "@/components/platform/states";
import type { ServiceId } from "@/platform/registry/products";
import { nodeHealth } from "../model";
import { useHealthPoll } from "./HealthProvider";

/**
 * The live part of one map node, drawn in SVG: a coloured rail, a glyph (hidden from assistive tech)
 * and the state in words. The words carry `labelId`, which the node's link names itself by.
 */
export function NodeHealth({
  services,
  labelId,
  x,
  y,
  fontSize,
  rail,
}: {
  services: readonly ServiceId[];
  labelId: string;
  x: number;
  y: number;
  fontSize: number;
  rail: { x: number; y: number; h: number };
}) {
  const { snapshot } = useHealthPoll();
  const { state, detail } = nodeHealth(services, snapshot);
  const meta = STATE_META[state];
  const fill = TONE_FILL[meta.tone];

  return (
    <g data-state={state} className="map-health">
      <rect x={rail.x} y={rail.y} width={3} height={rail.h} rx={1.5} className={fill} />
      <SvgDecoration>
        <text
          x={x}
          y={y}
          fontSize={fontSize}
          className={`${fill} ${meta.pulse ? "motion-safe:animate-pulse" : ""}`}
        >
          {meta.glyph}
        </text>
      </SvgDecoration>
      <text id={labelId} x={x + fontSize * 1.3} y={y} fontSize={fontSize} className={fill}>
        {meta.label}
        {detail ? <tspan className="fill-fg-muted"> · {detail}</tspan> : null}
      </text>
    </g>
  );
}
