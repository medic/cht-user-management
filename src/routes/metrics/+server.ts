import { metricsResponse } from '$lib/server/metrics';

// GET /metrics: Prometheus metrics, for scraping. Public, as in the previous version: restrict it at
// the ingress if it shouldn't be reachable from outside
export const GET = () => metricsResponse();
