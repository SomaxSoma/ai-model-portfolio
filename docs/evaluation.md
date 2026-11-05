# Evaluation: how each proposal metric is measured

Proposal §6 defines success with measurable criteria. The table shows where each one is measured, whether automatically in CI, live in the admin console (**Admin → Evaluation**), or both.

| Metric (proposal) | Target | How it's measured | Where |
|---|---|---|---|
| **Cost-calculation correctness** (primary, §6.1) | 100% match | 17 hand-verified cases in `packages/domain/src/golden-cases.ts`. Each has its arithmetic written out in `working`. CI fails on any mismatch, and the admin dashboard re-runs every case on each load. | CI (`npm test -w @pf/domain`), live |
| **Budget compliance** (§6.2) | 100% of valid recommendations within budget | Every stored recommendation that claims to be within budget has its stored cost compared against its workload's budget. The engine's own tests also cover the budget loop, the infeasible case, zero budgets and the cheapest-model fallback. | Live, CI |
| **Data freshness** (§6.2) | Reflected within 24 h | Each model's `last_verified_at` is updated whenever an ingestion run or admin save confirms its figures. An hourly job flags models not confirmed for over 24 h (`STALE_DATA`), and confirmation clears the flag. The live OpenRouter source is scheduled every 60 minutes (daily via Vercel Cron on the Hobby plan). | Live, data-quality queue |
| **API responsiveness** (§6.2) | ~2 s under pilot load | `npm run load-test` drives six common dashboard endpoints with 10 concurrent clients (the 5–10 pilot users) and fails above 2,000 ms at p97.5 (stricter than p95). Every API instance also records p50/p95 per route. | CI (e2e job and staging), live (Operations) |
| **Reliability** (§6.2) | ≥ 99% availability | The share of requests answered without a 5xx, per instance. `/health` and `/health/ready` back container healthchecks, so an unhealthy API is restarted. | Live, Docker healthchecks |
| **Usability** (§6.2) | ≥ 4/5 clarity | After each recommendation, a feedback card asks for a 1–5 clarity rating. | Live |
| **Pilot comparison** (§6.3) | — | The same card asks which model the user used before. The dashboard compares that model's single-model cost with the recommended portfolio's cost, and checks whether the old model actually met the workload's required capabilities. | Live |

## Local reference results

Measured on the development machine on 2026-11-05: Windows 11, embedded PostgreSQL 18, a single API process.

- Golden cost cases: **17/17** match.
- Load test, 10 connections for 5 s per endpoint. p97.5 latency was 6–14 ms on every endpoint, with 0 non-2xx responses.

  | Endpoint | Throughput | p97.5 |
  |---|---|---|
  | `/models` | ~2,700 req/s | 7 ms |
  | `/analytics/overview` | ~950 req/s | 14 ms |
  | `/portfolios` | ~1,050 req/s | 12 ms |

- End-to-end: 4/4 Playwright journeys pass on desktop (1440×900) and mobile (Pixel 7), with no console errors and no horizontal overflow.
