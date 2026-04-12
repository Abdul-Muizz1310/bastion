import { SERVICES } from "./services";

export type ServiceHealthResult = {
  id: string;
  healthy: boolean;
  version?: string;
  latencyMs: number;
  error?: string;
};

const HEALTH_TIMEOUT_MS = 5_000;

export async function checkServiceHealth(serviceId: string): Promise<ServiceHealthResult> {
  const service = SERVICES.find((s) => s.id === serviceId);
  if (!service) {
    throw new Error(`Unknown service: ${serviceId}`);
  }

  // CLI-only services (no backend URL)
  if (!service.backendUrl) {
    return {
      id: service.id,
      healthy: true,
      latencyMs: 0,
      version: "CLI",
    };
  }

  const url = `${service.backendUrl}${service.healthPath}`;
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    const healthy = response.ok;

    let version: string | undefined;
    try {
      const body = await response.json();
      version = body.version ?? body.commit ?? undefined;
    } catch {
      // Response may not be JSON
    }

    return { id: service.id, healthy, latencyMs, version };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    const isTimeout = error.includes("abort");

    return {
      id: service.id,
      healthy: false,
      latencyMs,
      error: isTimeout ? "timeout" : error,
    };
  }
}

export async function getAggregatedStatus(): Promise<ServiceHealthResult[]> {
  const results = await Promise.all(SERVICES.map((s) => checkServiceHealth(s.id)));
  return results;
}
