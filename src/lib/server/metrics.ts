import { collectDefaultMetrics, Histogram, register, Summary } from 'prom-client';

// Prometheus metrics at GET /metrics, as the previous version served them through fastify-metrics:
// prom-client's default Node.js and process metrics, and each request's duration by method, route
// and status. The previous version's Grafana dashboard (docs/legacy/deploy/watchdog-config) charts
// the default ones.

const IGNORED_METHODS = new Set(['HEAD', 'OPTIONS', 'TRACE']);
// the route of a request no route matched
const UNKNOWN_ROUTE = '__unknown__';

// kept on globalThis: the dev server reloads modules, and prom-client refuses a metric registered twice
const state = globalThis as typeof globalThis & { chtIamMetrics?: { histogram: Histogram; summary: Summary } };

function routeMetrics() {
  if (!state.chtIamMetrics) {
    collectDefaultMetrics();
    const labelNames = ['method', 'route', 'status_code'];
    state.chtIamMetrics = {
      histogram: new Histogram({ name: 'http_request_duration_seconds', help: 'request duration in seconds', labelNames }),
      summary: new Summary({ name: 'http_request_summary_seconds', help: 'request duration in seconds summary', labelNames })
    };
  }
  return state.chtIamMetrics;
}

export function startMetrics(): void {
  routeMetrics();
}

// Starts timing a request; the returned function records it with its response's status. `route` is
// SvelteKit's route id (eg. /api/v2/places/[placeId]), or null when no route matched
export function timeRequest(method: string): ((route: string | null, status: number) => void) | undefined {
  if (IGNORED_METHODS.has(method)) {
    return undefined;
  }
  const { histogram, summary } = routeMetrics();
  const endHistogram = histogram.startTimer();
  const endSummary = summary.startTimer();
  return (route, status) => {
    const labels = { method, route: route ?? UNKNOWN_ROUTE, status_code: status };
    endHistogram(labels);
    endSummary(labels);
  };
}

export async function metricsResponse(): Promise<Response> {
  routeMetrics();
  return new Response(await register.metrics(), { headers: { 'Content-Type': register.contentType, 'Cache-Control': 'no-store' } });
}
