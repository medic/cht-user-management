import { describe, expect, it } from 'vitest';

import { metricsResponse, timeRequest } from './metrics';

describe('/metrics', () => {
  it("serves the default metrics and each request's duration by method, route and status, as before", async () => {
    timeRequest('POST')?.('/api/v1/search', 200);
    timeRequest('GET')?.(null, 404);
    expect(timeRequest('HEAD')).toBeUndefined();

    const response = await metricsResponse();
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/);
    const text = await response.text();
    expect(text).toContain('process_resident_memory_bytes');
    expect(text).toContain('nodejs_eventloop_lag_seconds');
    expect(text).toMatch(/http_request_duration_seconds_count\{method="POST",route="\/api\/v1\/search",status_code="200"\} 1/);
    expect(text).toMatch(/http_request_summary_seconds_count\{method="GET",route="__unknown__",status_code="404"\} 1/);
    expect(text).not.toContain('method="HEAD"');
  });
});
