# Decisions and assumptions

Every place where the build departs from, or fills a gap in, `handoff_claude_code/`. Most important first.

## 1. Missing inputs

The handoff zip contained only `handoff_claude_code/*.md`. These were **not supplied**:

| Missing | What was done instead |
|---|---|
| `_ds/website-design-system-61a5ce01-…/` (Sentient Futures bundle) | Built `packages/design-system` from `DESIGN-airtable.md`, which was supplied as the design system to use. See §2. |
| `ui_kits/portfolio-app/` (prototype, `catalogue.jsx`) | Layout and copy follow `03-screens.md`. Algorithms follow `04-domain-logic.md`. **Re-check both against `catalogue.jsx` once it is available.** |
| Sample catalogue in `catalogue.jsx` | Wrote `apps/api/src/seed/sample-catalogue.ts`: 4 providers and 8 models (one retired), with generic names in the style the README cites ("GPT-class Frontier"). Flagged as sample data in the file, in the UI footer and on the About page. |
| `docs/uml/` | Not needed. The schema follows `05-data-model.md`. |

## 2. Design system: Airtable spec in place of the Sentient Futures bundle

`packages/design-system` implements the component inventory from `02-design-system.md`: `Card`, `Button`, `TextLink`, `FilterChip`, `SearchInput`, `Field`, `Stat`, `Table`, `Badge`, `TopicTag`, `Alert`, `Tabs`, `SegmentedNav`, `Select` and `Footer`. Names and props match the inventory, so a different bundle can replace the package without screen changes. Values come from `DESIGN-airtable.md`.

The Airtable spec conflicts with the Sentient Futures spec in places. **The Airtable spec wins**:

- **Corners.** Not square-cornered. Radii follow Airtable: 12px buttons, 10px cards, 6px inputs, full radius for chips and dots. Cards still have no shadows.
- **Primary action.** Primary is near-black (`--primary` = `#181d26`), not Future Blue.
- **Accent.** The accent role (selected state, active nav tab, links, slider fill, selected-card outline) is the Airtable link blue (`--accent` = `--link` = `#1b61c9`). The focus ring is `--info-border`.
- **Recommendation banner.** Within budget uses the dark signature surface (`--surface-dark`). Over budget uses `--pf-negative`.
- **Status colours.** Airtable defines no error colour (its "Known Gaps" section says so). The package adds `--danger`, reusing signature coral `#aa2d00`, plus light surface tints for `Alert`. `--pf-positive` is `var(--success)` and `--pf-negative` is `var(--danger)`, so validation ticks and `Alert` share hues.
- **Muted text.** Airtable's `--muted` (`#41454d`) can barely be told apart from body text (`#333840`). `--muted-foreground` is `#5c626c` instead: 6:1 contrast on white, still AA, and visibly lighter. This satisfies the Step 4 checkpoint that supporting text is visibly muted.
- **Type.** Haas Grotesk is licensed, so Inter (variable) substitutes, as the spec's own substitute note recommends.
- **Hover.** No hover styling, per the spec's no-hover policy. Only default and active states.
- **The `Table` overflow trap.** The stand-in `Table` doesn't clip. The app still wraps every table in its own scroll container (`.pf-table-scroll`) and releases both overflow axes on the inner wrapper, so swapping in a bundle that clips is safe.

App CSS (`apps/web/src/theme.css`) references tokens only, with no colour literals. App variables use the `--pf-` prefix. Only the top bar, the text input (`.pf-input`) and the range slider (`.pf-slider`, a single native track with its fill painted from `--pct`) are built locally.

## 3. Data model

- **`USER` is named `app_user`**, because `user` is reserved in PostgreSQL.
- **`ai_model.capabilities jsonb`** is added. The spec's table list has no capability storage, but eligibility needs it. It mirrors `workload.required_capabilities`.
- **`portfolio.workload_id`** is added (NOT NULL, FK). To recompute costs on save, the server needs the workload's volumes, and `PORTFOLIO` had no route to them.
- **`recommendation`** gains `allocations jsonb` (a snapshot, so `GET /recommendations/{id}` re-opens without recomputing), `within_budget` and `adjusted`.
- **Money scale.** Prices and budgets are `numeric(12,4)`. Computed estimated costs (`portfolio_model.estimated_cost`, `recommendation.estimated_cost`) are `numeric(18,4)`, because volume × price can exceed 8 integer digits within the allowed input limits.
- **History tables** are append-only. `ON DELETE RESTRICT` applies from `ai_model`, and no API deletes models.
- **Denormalisation.** `recordPricing` and `recordBenchmark` in `apps/api/src/repositories/catalogue.ts` are the only writers of `ai_model`'s price and score columns. Each inserts the history row and updates the model in the same transaction. An admin edit that leaves a value unchanged writes no history row.

## 4. Domain logic (`packages/domain`)

- **One cost function.** `monthlyCost()` is used by the API, the workload preview, allocation rows, the breakdown table and server-side save checks. It runs on `decimal.js` and rounds half-up to 4 dp, the stored scale. A total is the sum of its rounded lines, so every displayed figure adds up.
- **"Full cost"** in the budget loop means a model's cost at 100% share.
- **Deterministic ties.** Ranking is score descending, then cheaper, then lower model id.
- **Infeasible budget.** The spec's loop stops when the donor is at 5% or less, so it can't reach "all on the cheapest model". If the loop result is still over budget, the engine returns **100% on the cheapest eligible model**, taken from the whole eligible set rather than only the top 3. That allocation is the true cost floor. If it fits the budget, the result has `withinBudget: true` and `adjusted: true`. If not, it has `withinBudget: false` and a reason that names the overage. The result is never an error and never empty unless nothing is eligible.
- **Zero budget.** The library handles a zero budget (it is tested). Workload validation still requires a budget above 0, per the spec.
- **Percentages** are whole numbers. "Normalise to 100%" scales proportionally and adds the drift to the largest share.
- **Blended score** is the allocation-weighted `overallScore`, to one decimal place.
- **The 60/40 split** is `SCORING_WEIGHTS`. Portfolio size, adjustment step and step cap are in `RECOMMENDATION_CONFIG`.

## 5. API

- **Portfolio payload.** `POST /portfolios` takes `{ workloadId, recommendationId?, name, budget, allocations: [{ modelId, allocationPercentage }] }`. The server ignores any client-sent cost and recomputes every line. When `recommendationId` is given, the recommendation is linked to the new portfolio (`recommendation.portfolio_id`).
- **Save rules** (POST and PATCH):
  - Allocations must total exactly 100%.
  - The total must be within the **portfolio** budget.
  - There must be at least one line.
  - Every model must still be eligible for the workload, so retired models and missing capabilities are rejected.
  - 0% lines are dropped rather than stored.
- **Status codes.** 400 is for malformed input and field validation (including portfolio name and budget format). 422 is for allocation and budget rule failures. 401, 403, 404 and 409 are used as usual. Other users' workloads, recommendations and portfolios return 404, never 403, so their existence isn't revealed.
- **Added endpoints:** `GET /me` (the client loads the role from the server on start) and `GET /portfolios` (the current user's saved portfolios; the spec lists only single-item GET).
- **Error wording.** A global zod fallback means that if a schema lacks its own message, users see "This field is required." rather than schema language.

## 6. Auth

- Email and password, with argon2id hashes. A JWT bearer token (12h) carries only the user id.
- **The role is read from the database on every request**, never from the token or the client. Demoting an admin takes effect immediately.
- Self-registration always creates a `USER`, and a `role` in the request body is ignored. The first admin comes from the `SEED_ADMIN_*` environment variables via `npm run seed`.
- The prototype's demo role switch is not built.

## 7. UI

- **"Portfolio" nav item.** It opens the last recommendation viewed this session. Otherwise it shows the empty state ("Define workload") and the user's saved portfolios.
- **Re-opening a saved recommendation.** Opening a recommendation that was already saved redirects to the saved portfolio, so it can't be saved twice by accident.
- **Banner and budgets.** The banner compares the live allocation to the **workload** budget, as the spec's metric is labelled. The Save check uses the **portfolio** budget from the side panel.
- **Compare** is capped at 4 models, to keep the matrix readable.
- **Planner state** (compare set, workload form draft) resets when the signed-in account changes.
- **Footer.** It needs destinations and may not link to internal or dev pages, so I added an **About / "How it works"** page explaining costs, scoring, recommendations and the sample data. The footer links there.
- **Admin.** The spec's admin screen covers inline price, score and status edits plus providers. There is **no add-model form** in the UI; `POST /models` exists in the API.

## 8. Stack and tooling

- npm workspaces: `packages/domain`, `packages/design-system`, `apps/api` (Fastify 5, `pg`, zod 4) and `apps/web` (React 19, Vite 8, React Router 7). TypeScript 7.
- `@pf/domain` and `@pf/design-system` are consumed as TypeScript source, with no build step. The API runs under `tsx`. A production deploy needs either a bundling step for the API or the same runtime.
- **PostgreSQL:** neither Postgres nor Docker was installed on the dev machine. The `embedded-postgres` package runs real PostgreSQL 18 binaries for `npm run db` and for the integration tests, which use a throwaway instance. Any PostgreSQL works via `DATABASE_URL` (or `TEST_DATABASE_URL` for the tests).
- Redis and the ingestion worker are not built; they are optional in v1.
