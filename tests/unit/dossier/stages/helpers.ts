import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Dossier } from "@/lib/db/schema";
import type { Json, StageContext } from "@/dossier/stages";

export function fixture(service: string, name: string): unknown {
  return JSON.parse(
    readFileSync(resolve(__dirname, "../../../fixtures/downstream", service, name), "utf8"),
  );
}

export const DOSSIER_ID = "550e8400-e29b-41d4-a716-446655440000";

export function dossier(over: Partial<Dossier> = {}): Dossier {
  return {
    id: DOSSIER_ID,
    userId: null,
    visitor: "v_kk6eooepno",
    claim: "small entity fees are reduced",
    sources: [],
    mode: "rapid",
    status: "running",
    verdict: null,
    confidence: null,
    requestId: "req-dossier-1",
    envelopeId: null,
    error: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

export function stageCtx(over: Partial<StageContext> & { outputs?: StageContext["outputs"] } = {}): StageContext {
  return {
    dossier: dossier(),
    requestId: "req-dossier-1",
    outputs: {},
    now: new Date("2026-10-20T10:00:00Z"),
    attempt: 1,
    startedAt: new Date("2026-10-20T10:00:00Z"),
    signal: new AbortController().signal,
    ...over,
  };
}

export type { Json };
