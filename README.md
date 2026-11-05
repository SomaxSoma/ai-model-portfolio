# AI Model Portfolio Intelligence Platform

A web platform that treats AI models as **portfolio components**. It compares models on price, benchmarks, latency, reliability and lifecycle. For each workload it recommends a mix of models that fits a monthly budget, and explains the trade-offs. It also analyses provider concentration risk and simulates price rises, deprecations and outages before they happen.

It never sends prompts to a provider. It reasons only over its catalogue.

> **Sample data.** The seeded catalogue and the bundled feed (`data/sample-feed.json`) are illustrative. Replace them with licensed, attributed data before real use.

## What's inside (proposal §4.1)

| Component | Where |
|---|---|
| Model and provider catalogue (pricing, benchmarks, latency, reliability, lifecycle, full history) | Catalogue, model detail, compare |
| Workload and cost calculator: one decimal-exact cost function shared by API and UI | Workload screen, `packages/domain/src/cost.ts` |
| Portfolio manager: allocation sliders, budget validation, server-side checks | Recommendation and portfolio screens |
| Recommendation engine: configurable quality, cost, latency and reliability weights | `packages/domain/src/recommend.ts` |
| Provider risk analyzer (HHI concentration plus retirement exposure) | Portfolio screen, `GET /portfolios/:id/risk` |
| What-if simulator (price change, deprecation, provider outage) | `/portfolios/:id/what-if` |
| Data ingestion (scheduled FILE/HTTP feeds) with a data-quality review queue | Admin → Ingestion, Data quality |
| Alerts: cost changes, budget breaches, retirements, ingestion failures | Bell menu, `/notifications` |
| Analytics dashboard: 3D model galaxy, cost-vs-quality, price index, spend by provider | `/dashboard` |
| Admin and ops dashboards: endpoint latency, availability, cache, jobs, and evaluation metrics | Admin → Operations, Evaluation |

## Quick start (local)

Requires Node 22+. You don't need to install PostgreSQL or Redis: `npm run db` starts a local PostgreSQL, and without Redis the API uses an in-memory cache and runs scheduled jobs in its own process.

```bash
npm install
```

```bash
npm run db
```

In a second terminal, create the schema, seed the sample catalogue, admin and feed, and start the API on :3001:

```bash
npm run migrate && npm run seed && npm run dev:api
```

In a third terminal, start the web app on http://localhost:5173:

```bash
npm run dev:web
```

Sign in as the seeded admin (`SEED_ADMIN_*` in `.env.example`), or register a new account, which gets the user role.

## Quality gates

```bash
npm run lint
```

```bash
npm run typecheck
```

Unit and integration tests. The domain suite includes the 17 hand-verified golden cost cases (proposal §6.1). The API suite runs against a throwaway PostgreSQL, plus Redis when `REDIS_URL` is set:

```bash
npm test
```

End-to-end journeys in Chromium, on desktop and mobile:

```bash
npx playwright install chromium && npm run test:e2e
```

Load test (proposal §6.2: ≤ 2 s at pilot load), against a running API:

```bash
npm run load-test
```

## Staging (Docker)

CI builds the API/worker and web images on every push to `main` and publishes them to GitHub Container Registry. It then boots the full staging stack (PostgreSQL, Redis, migrate, API, worker, nginx), smoke-tests it, and load-tests it. To run the same stack anywhere with Docker, first create your env file:

```bash
cp deploy/staging.env.example deploy/staging.env
```

```bash
docker compose -f deploy/docker-compose.staging.yml --env-file deploy/staging.env up -d
```

The app is then served on http://localhost:8080. Add `--build` to build the images locally instead of pulling them.

## Layout

```
packages/domain/         Cost, eligibility, scoring, recommendation, risk, what-if, golden cases
packages/design-system/  Dark "observatory" tokens + components
apps/api/                Fastify API, migrations, ingestion, alerts, jobs, worker, tests
apps/web/                React + Vite client; src/three = three.js scenes
data/                    Sample ingestion feed
deploy/                  Dockerfiles, nginx, staging compose
e2e/                     Playwright journeys
docs/                    Architecture and evaluation method
DECISIONS.md             Every assumption and departure from the spec and proposal
```
