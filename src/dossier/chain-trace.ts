import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";

/**
 * The dossier chain's trace (spec 21 §6.2, diagnostic): one structured line per chain event — ids,
 * stages, statuses and milliseconds only, never a token, a header's value or a body — to the log
 * and, when Upstash is configured, to a per-dossier list, because a platform may not keep what a
 * function logs after its answer. Writing a line never throws and holds its caller at most
 * `capMs`. The line format is pure (`traceLine`); the sinks are the shell.
 */

export type TraceValue = string | number | boolean | null;

export type ChainEventName =
  | "advance.entry"
  | "advance.refused"
  | "advance.claim"
  | "advance.idle"
  | "advance.outcome"
  | "advance.answer"
  | "chain.decision"
  | "start.chain"
  | "chain.after"
  | "chain.sleep"
  | "chain.fetch"
  | "chain.response"
  | "chain.letgo"
  | "chain.error"
  | "chain.settled"
  | "drive.stage"
  | "drive.stop"
  | "sweep.entry"
  | "sweep.done";

export type ChainTraceEvent = {
  event: ChainEventName;
  dossierId: string;
  invocation: string;
} & { [field: string]: TraceValue };

export type Tracer = (event: ChainTraceEvent) => Promise<void>;

export const TRACE_TAG = "dossier-chain";
/** How many lines a dossier's list keeps (the newest), and for how long. */
export const TRACE_KEEP = 500;
export const TRACE_TTL_S = 2 * 24 * 60 * 60;
const CAP_MS = 500;
const ID_CHARS = /^[A-Za-z0-9:_.-]{1,96}$/;

/** One line, pure: the tag, the time, then the event's fields in order. */
export function traceLine(event: ChainTraceEvent, nowMs: number): string {
  return JSON.stringify({ tag: TRACE_TAG, at: new Date(nowMs).toISOString(), ...event });
}

/** An id read from a header (an invocation, a platform request id), kept only if it is one. */
export function traceId(raw: string | null): string | null {
  return raw !== null && ID_CHARS.test(raw) ? raw : null;
}

/** A fresh 8-hex id for one invocation. */
export function newInvocationId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 8);
}

const INSTANCE = newInvocationId();
let served = 0;

/** This instance's id (one per process), how many requests it has served, and its region. */
export function instanceFacts(): {
  instance: string;
  served: number;
  coldStart: boolean;
  region: string | null;
} {
  served += 1;
  return {
    instance: INSTANCE,
    served,
    coldStart: served === 1,
    region: process.env.VERCEL_REGION ?? null,
  };
}

export type TraceSink = {
  push(dossierId: string, line: string): Promise<void>;
  /** The dossier's lines, oldest first. */
  read(dossierId: string): Promise<string[]>;
};

type RedisLike = {
  pipeline(): {
    lpush(key: string, value: string): unknown;
    ltrim(key: string, start: number, stop: number): unknown;
    expire(key: string, seconds: number): unknown;
    exec(): Promise<unknown>;
  };
  lrange(key: string, start: number, stop: number): Promise<unknown[]>;
};

const key = (dossierId: string) => `diag:chain:${dossierId}`;

export function redisTraceSink(redis: RedisLike): TraceSink {
  return {
    async push(dossierId, line) {
      const p = redis.pipeline();
      p.lpush(key(dossierId), line);
      p.ltrim(key(dossierId), 0, TRACE_KEEP - 1);
      p.expire(key(dossierId), TRACE_TTL_S);
      await p.exec();
    },
    async read(dossierId) {
      const lines = await redis.lrange(key(dossierId), 0, TRACE_KEEP - 1);
      return lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).reverse();
    },
  };
}

/** Upstash when it is configured; otherwise none, and the trace is the log alone. */
export function traceSinkFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): TraceSink | null {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  return url && token
    ? redisTraceSink(new Redis({ url, token, automaticDeserialization: false }))
    : null;
}

export function createTracer(options: {
  sink: TraceSink | null;
  log?: (line: string) => void;
  now?: () => number;
  capMs?: number;
}): Tracer {
  const log = options.log ?? ((line: string) => console.info(line));
  const now = options.now ?? Date.now;
  const capMs = options.capMs ?? CAP_MS;
  return async (event) => {
    const line = traceLine(event, now());
    try {
      log(line);
    } catch {
      // A log that throws must not stop a stage.
    }
    if (options.sink === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, capMs);
    });
    try {
      await Promise.race([options.sink.push(event.dossierId, line).catch(() => {}), cap]);
    } finally {
      clearTimeout(timer);
    }
  };
}

let shared: Tracer | null = null;

/** The process's tracer: the log, plus Upstash when configured (built on first use). */
export const chainTracer: Tracer = (event) => {
  shared ??= createTracer({ sink: traceSinkFromEnv(process.env) });
  return shared(event);
};
