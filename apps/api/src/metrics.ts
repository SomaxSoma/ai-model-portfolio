/**
 * Request metrics for the operations dashboard and the evaluation metrics
 * (proposal §6.2: responsiveness ≤ ~2 s, availability ≥ 99%).
 * Per-process and in memory: each API instance reports its own window.
 */
const WINDOW = 1000;

interface RouteStats {
  durations: number[];
  count: number;
  errors: number;
}

export class Metrics {
  readonly startedAt = new Date();
  private routes = new Map<string, RouteStats>();

  record(method: string, route: string, status: number, ms: number) {
    const key = `${method} ${route}`;
    const s = this.routes.get(key) ?? { durations: [], count: 0, errors: 0 };
    s.count++;
    if (status >= 500) s.errors++;
    s.durations.push(ms);
    if (s.durations.length > WINDOW) s.durations.shift();
    this.routes.set(key, s);
  }

  summary() {
    const routes = [...this.routes.entries()]
      .map(([route, s]) => ({
        route,
        count: s.count,
        errors: s.errors,
        p50Ms: round(percentile(s.durations, 50)),
        p95Ms: round(percentile(s.durations, 95)),
        maxMs: round(Math.max(0, ...s.durations)),
      }))
      .sort((a, b) => b.count - a.count);
    const all = [...this.routes.values()].flatMap((s) => s.durations);
    const requests = [...this.routes.values()].reduce((a, s) => a + s.count, 0);
    const errors = [...this.routes.values()].reduce((a, s) => a + s.errors, 0);
    return {
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.round((Date.now() - this.startedAt.getTime()) / 1000),
      requests,
      serverErrors: errors,
      /** Share of requests answered without a server error, 0–100. */
      availability: requests ? round(((requests - errors) / requests) * 100, 2) : 100,
      p95Ms: round(percentile(all, 95)),
      routes,
    };
  }
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
