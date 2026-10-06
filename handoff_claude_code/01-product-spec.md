# 1. Product spec

## Problem

A team adopting AI models has to choose between dozens of models that differ on price, benchmark quality, context window and capabilities. Choosing one model for everything either overspends (frontier model on trivial work) or underdelivers (cheap model on hard work). The answer is usually a **portfolio**: a share of the workload on each of several models.

## Actors

| Actor | Does |
|---|---|
| **User** | Registers, logs in, browses and compares models, defines a workload, generates a recommendation, edits and saves a portfolio |
| **Admin** | Logs in, manages providers and models, updates pricing and benchmark data |

Admin is **not a separate entity** — it is `user.role = 'ADMIN'`. Keep it that way; the UI branches on role, the data model does not.

## MVP scope

**User:** register · login · view models · view model details · compare models · define workload · calculate estimated cost · create portfolio · allocate workload percentages · validate against budget · generate recommendation · view recommendation and cost breakdown.

**Admin:** login · manage providers · manage models · update pricing · update benchmark data.

## Explicitly OUT of scope — do not build

Listed so nobody "helpfully" adds them:

- Historical trend forecasting and advanced analytics
- Provider risk analysis
- What-if scenario simulation
- Notifications of any kind
- ML-based prediction
- **Real-time API routing or prompt execution**
- Team workspaces, sharing, multi-tenant org management

## Supporting infrastructure (optional in v1)

Redis (cache + job queue) and a scheduled ingestion worker that refreshes pricing/benchmark records from public sources. **No MVP use case depends on them** — an admin can maintain the same data by hand. Ship without them if it saves a week.

## Success criteria

1. A user can go from login to a saved, budget-valid portfolio in under three minutes.
2. Changing an input price in the admin console changes the next recommendation.
3. Every cost shown anywhere in the app is derived from the same single cost function.
