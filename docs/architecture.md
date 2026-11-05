# Architecture

```
            Browser (React + Vite, three.js scenes, Recharts)
                     │  same-origin /api
              ┌──────▼──────┐
              │    nginx    │  static assets, SPA fallback, security headers
              └──────┬──────┘
                     │
        ┌────────────▼────────────┐        ┌───────────────┐
        │  API (Fastify, stateless)│◄──────►│     Redis     │ cache + BullMQ queue
        │  N instances             │        └───────▲───────┘
        └────────────┬────────────┘                │
                     │                     ┌───────┴───────┐
                     │                     │    Worker     │ scheduled ingestion,
                     │                     │  (same image) │ freshness checks
                     │                     └───────┬───────┘
              ┌──────▼───────────────────────────────▼──┐
              │               PostgreSQL                 │
              └──────────────────────────────────────────┘
```

## Packages

| Package | Role |
|---|---|
| `packages/domain` | Pure TypeScript: the single cost function, eligibility, configurable scoring, allocation and the budget loop, provider risk (HHI), the what-if simulator, validation, and the golden cost cases. Used by both the API and the browser, so there is exactly one implementation of every rule. |
| `packages/design-system` | Tokens (light, two-colour violet → cyan theme) and components (`Card`, `Button`, `Table`, `Tabs` and others). |
| `apps/api` | Fastify REST API, SQL migrations, repositories, services (alerts, ingestion), jobs (scheduler and worker), and integration tests. |
| `apps/web` | React client: screens, charts, and three.js scenes (`src/three`). |

## Key flows

- **Recommendation:** `POST /workloads/:id/recommendation` loads the catalogue (from cache) and runs `recommend()` with the workload's scoring weights. It persists the snapshot before returning.
- **Catalogue change:** an admin edit or ingestion run goes through `updateModel()`, which writes a history row and updates the model in the same transaction. The cache is then invalidated, and `notifyCatalogueChanges()` alerts the owners of every affected portfolio.
- **Ingestion:** a scheduler (BullMQ repeatable job, or an in-process ticker without Redis) runs due sources. Each feed record is validated, then applied in its own transaction. Large jumps are flagged for review and invalid records are rejected; both create data-quality issues and admin alerts.
- **What-if:** `POST /portfolios/:id/simulate` applies the scenario to a copy of the catalogue. It returns the current allocation, the same allocation under the scenario (lost shares spread over the surviving models), and a fresh recommendation.

## Scalability (proposal §7)

- **Stateless API instances:** auth is a bearer token, and the role is read from the database on each request. The cache is shared through Redis.
- **Scheduled work in a separate worker:** set `SCHEDULER=off` on the API and run the worker against Redis.
- **Indexes** cover every lookup path: model by provider, history by model and time, portfolios by user, portfolio lines by model, unread notifications, and open data-quality issues.
- **Paginated endpoints:** models, model history, notifications and ingestion runs (`limit`/`offset`, `X-Total-Count`).
- **Common feed schema:** a new provider is added by pointing an ingestion source at a feed, with no schema changes.
