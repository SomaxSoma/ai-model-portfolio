# AI Model Portfolio Intelligence Platform

A decision-support web app. It compares AI models on price, benchmarks and capabilities, then recommends a **portfolio** of models that fits a monthly budget. It never sends prompts to a provider.

> **Sample data.** The seeded catalogue is illustrative (`apps/api/src/seed/sample-catalogue.ts`). Replace it with licensed, attributed data before real use.

## Quick start

Requires Node 22+. You don't need to install PostgreSQL: `npm run db` runs a local instance.

```bash
npm install
```

```bash
npm run db
```

In a second terminal, create the schema, seed the sample catalogue and admin, and start the API on :3001:

```bash
npm run migrate && npm run seed && npm run dev:api
```

In a third terminal, start the web app on http://localhost:5173:

```bash
npm run dev:web
```

Sign in as the seeded admin (`SEED_ADMIN_*` in `.env.example`), or register a new account, which gets the user role.

## Tests

```bash
npm test
```

- `packages/domain`: unit tests for the cost function, eligibility, scoring, allocation with rounding drift, the budget loop, and the infeasible, zero-budget, no-eligible-model and equal-cost cases.
- `apps/api`: integration tests against a throwaway PostgreSQL. They follow the build plan's checkpoints: the seed, auth and the admin guard, validation, the recommendation (including an impossible budget), server-side save checks, and an admin price change altering the next recommendation.

```bash
npm run typecheck
```

## Layout

```
packages/domain/         The algorithms. One cost function shared by API and UI.
packages/design-system/  Tokens + components (from DESIGN-airtable.md)
apps/api/                Fastify REST API, SQL migrations, seed, integration tests
apps/web/                React + Vite client
handoff_claude_code/     The original spec
DECISIONS.md             Every assumption and departure from the spec
```
