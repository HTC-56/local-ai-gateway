import { describe, expect, it } from 'vitest';
import { LATENCY_BUCKETS_MS, createMetrics } from '../src/metrics.ts';

/** Every sample line for one metric family, in render order. */
function samplesFor(text: string, metric: string): string[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith(metric) && !line.startsWith('#'));
}

describe('createMetrics renders the exposition format', () => {
  it('omits a metric that has no samples', () => {
    expect(createMetrics().render()).toBe('');
  });

  it('emits HELP and TYPE before a counter and ends with a newline', () => {
    const metrics = createMetrics();
    metrics.recordRequest('fast', 'ok');

    const text = metrics.render();
    expect(text).toContain('# HELP gateway_requests_total ');
    expect(text).toContain('# TYPE gateway_requests_total counter\n');
    expect(text).toContain('gateway_requests_total{model="fast",outcome="ok"} 1\n');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('counts requests per model and outcome, sorted', () => {
    const metrics = createMetrics();
    metrics.recordRequest('fast', 'ok');
    metrics.recordRequest('fast', 'ok');
    metrics.recordRequest('fast', 'error');
    metrics.recordRequest('coder', 'ok');

    expect(samplesFor(metrics.render(), 'gateway_requests_total')).toEqual([
      'gateway_requests_total{model="coder",outcome="ok"} 1',
      'gateway_requests_total{model="fast",outcome="error"} 1',
      'gateway_requests_total{model="fast",outcome="ok"} 2',
    ]);
  });

  it('escapes quotes and backslashes in label values', () => {
    const metrics = createMetrics();
    metrics.recordRequest('we"ird\\name', 'ok');

    expect(metrics.render()).toContain('model="we\\"ird\\\\name"');
  });
});

describe('the upstream latency histogram', () => {
  it('is cumulative, carries +Inf, and reports sum and count', () => {
    const metrics = createMetrics();
    metrics.recordUpstreamLatency('box-a', 5);
    metrics.recordUpstreamLatency('box-a', 90);
    metrics.recordUpstreamLatency('box-a', 99_999);

    const samples = samplesFor(metrics.render(), 'gateway_upstream_latency_ms');
    // One line per bucket, plus +Inf, plus _sum and _count.
    expect(samples).toHaveLength(LATENCY_BUCKETS_MS.length + 3);
    expect(samples).toContain('gateway_upstream_latency_ms_bucket{backend="box-a",le="10"} 1');
    expect(samples).toContain('gateway_upstream_latency_ms_bucket{backend="box-a",le="100"} 2');
    expect(samples).toContain('gateway_upstream_latency_ms_bucket{backend="box-a",le="+Inf"} 3');
    expect(samples).toContain('gateway_upstream_latency_ms_sum{backend="box-a"} 100094');
    expect(samples).toContain('gateway_upstream_latency_ms_count{backend="box-a"} 3');
  });

  it('puts a value exactly on a bucket bound into that bucket', () => {
    const metrics = createMetrics();
    metrics.recordUpstreamLatency('box-a', 100);

    const samples = samplesFor(metrics.render(), 'gateway_upstream_latency_ms');
    expect(samples).toContain('gateway_upstream_latency_ms_bucket{backend="box-a",le="50"} 0');
    expect(samples).toContain('gateway_upstream_latency_ms_bucket{backend="box-a",le="100"} 1');
  });

  it('keeps one histogram per backend', () => {
    const metrics = createMetrics();
    metrics.recordUpstreamLatency('box-a', 5);
    metrics.recordUpstreamLatency('box-b', 5);
    metrics.recordUpstreamLatency('box-b', 5);

    const text = metrics.render();
    expect(text).toContain('gateway_upstream_latency_ms_count{backend="box-a"} 1');
    expect(text).toContain('gateway_upstream_latency_ms_count{backend="box-b"} 2');
  });
});

describe('failovers', () => {
  it('counts per logical model and the backend that failed', () => {
    const metrics = createMetrics();
    metrics.recordFailover('fast', 'box-a');
    metrics.recordFailover('fast', 'box-a');

    expect(metrics.render()).toContain(
      'gateway_failovers_total{model="fast",backend="box-a"} 2\n',
    );
  });
});

describe('series derived at render time', () => {
  it('renders egress counters from the snapshot it is given', () => {
    const text = createMetrics().render({
      egress: {
        allowlist: ['192.0.2.10:11434'],
        allowed: 7,
        refused: 2,
        refusedByDestination: { 'example.invalid:443': 2 },
      },
    });

    expect(text).toContain('gateway_egress_allowed_total 7\n');
    expect(text).toContain('gateway_egress_refused_total{destination="example.invalid:443"} 2\n');
  });

  it('renders backend_up as 1 only for healthy backends', () => {
    const text = createMetrics().render({
      backends: [
        {
          name: 'box-a',
          baseUrl: 'http://192.0.2.10:11434/v1',
          state: 'healthy',
          lastProbe: null,
          latencyMs: 4,
          consecutiveFailures: 0,
          lastError: null,
        },
        {
          name: 'box-b',
          baseUrl: 'http://192.0.2.20:11434/v1',
          state: 'unhealthy',
          lastProbe: null,
          latencyMs: null,
          consecutiveFailures: 2,
          lastError: 'boom',
        },
        {
          name: 'box-c',
          baseUrl: 'http://192.0.2.30:11434/v1',
          state: 'unknown',
          lastProbe: null,
          latencyMs: null,
          consecutiveFailures: 0,
          lastError: null,
        },
      ],
    });

    expect(samplesFor(text, 'gateway_backend_up')).toEqual([
      'gateway_backend_up{backend="box-a"} 1',
      'gateway_backend_up{backend="box-b"} 0',
      'gateway_backend_up{backend="box-c"} 0',
    ]);
  });
});
