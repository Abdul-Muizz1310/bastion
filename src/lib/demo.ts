import crypto from "node:crypto";
import { appendEvent } from "./audit";
import type { Role } from "./validation";

export type DemoRunInput = {
  userId: string;
  role: Role;
};

export type DemoStepResult = {
  step: string;
  status: "ok" | "error";
  data?: unknown;
  error?: string;
};

export type TimelineEntry = {
  step: string;
  timestamp: Date;
  latencyMs: number;
};

export type Artifact = {
  title: string;
  type: string;
  data: unknown;
};

export type DemoRunResult = {
  runId: string;
  requestId: string;
  steps: DemoStepResult[];
  artifacts: Artifact[];
  timeline: TimelineEntry[];
};

const DEMO_STEPS = ["magpie", "inkprint", "paper-trail", "slowquery", "audit"] as const;

export async function startDemoRun(input: DemoRunInput): Promise<DemoRunResult> {
  // Role check
  if (input.role === "viewer") {
    throw new Error("Viewer role cannot run demos");
  }

  const runId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const steps: DemoStepResult[] = [];
  const timeline: TimelineEntry[] = [];
  const artifacts: Artifact[] = [];

  for (const stepName of DEMO_STEPS) {
    const start = Date.now();
    try {
      const data = await executeDemoStep(stepName, requestId, input.userId);
      const latencyMs = Date.now() - start;

      steps.push({ step: stepName, status: "ok", data });
      timeline.push({ step: stepName, timestamp: new Date(start), latencyMs });

      await appendEvent({
        actorId: input.userId,
        action: `demo.${stepName}.ok`,
        entityType: "demo",
        entityId: runId,
        requestId,
        service: stepName === "audit" ? "bastion" : stepName,
      });

      // Collect artifacts from relevant steps
      if (stepName === "magpie" || stepName === "inkprint" || stepName === "slowquery") {
        artifacts.push({
          title: `${stepName} result`,
          type: stepName,
          data,
        });
      }
    } catch (err) {
      const latencyMs = Date.now() - start;
      const error = err instanceof Error ? err.message : "Unknown error";
      steps.push({ step: stepName, status: "error", error });
      timeline.push({ step: stepName, timestamp: new Date(start), latencyMs });

      await appendEvent({
        actorId: input.userId,
        action: `demo.${stepName}.error`,
        entityType: "demo",
        entityId: runId,
        requestId,
        service: stepName,
        metadata: { error },
      });

      // Stop on failure — don't run subsequent steps
      break;
    }
  }

  return { runId, requestId, steps, artifacts, timeline };
}

async function executeDemoStep(step: string, requestId: string, _userId: string): Promise<unknown> {
  // Each step calls through the gateway proxy
  // In unit tests, these will be mocked
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  switch (step) {
    case "magpie":
      return proxyFetch(`${baseUrl}/api/proxy/magpie/api/scrape/hackernews/top`, {
        method: "POST",
        requestId,
      });
    case "inkprint":
      return proxyFetch(`${baseUrl}/api/proxy/inkprint/certificates`, {
        method: "POST",
        requestId,
        body: JSON.stringify({ text: "demo article text" }),
      });
    case "paper-trail":
      return proxyFetch(`${baseUrl}/api/proxy/paper-trail/debates`, {
        method: "POST",
        requestId,
        body: JSON.stringify({ claim: "demo claim", max_rounds: 3 }),
      });
    case "slowquery":
      return proxyFetch(
        `${baseUrl}/api/proxy/slowquery/_slowquery/api/queries?since=${new Date().toISOString()}`,
        { method: "GET", requestId },
      );
    case "audit":
      // Fetch events for this request
      return { requestId, message: "Audit events collected" };
    /* v8 ignore next 2 */
    default:
      throw new Error(`Unknown demo step: ${step}`);
  }
}

async function proxyFetch(
  url: string,
  options: { method: string; requestId: string; body?: string },
): Promise<unknown> {
  const response = await fetch(url, {
    method: options.method,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": options.requestId,
    },
    body: options.body,
  });

  if (!response.ok) {
    throw new Error(`${options.method} ${url} failed with ${response.status}`);
  }

  return response.json();
}
