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

---

# Phase 2: the full proposal scope (UCS503P)

The project proposal adds components that the original handoff listed as out of scope. Phase 2 builds all of them. Where this section conflicts with the sections above, **this section wins**.

## 9. Stack

The proposal names Next.js and FastAPI. On request, the existing TypeScript stack is kept: React/Vite, Fastify and PostgreSQL. Every proposal feature is built on it. Redis (cache and BullMQ queue), Docker and GitHub Actions follow the proposal (§8). Charts use Recharts, as the proposal suggests. No ML libraries are used: the recommendation engine stays rule-based and explainable (proposal §4.3, §5.1).

## 10. Visual design (supersedes §2)

On request, the UI moved from the Airtable-derived light theme to a dark "observatory" aesthetic, drawing on Linear, Vercel, Stripe and Raycast.

- **Tokens:** layered near-black surfaces, hairline borders, one violet→cyan accent, and Space Grotesk / Inter / JetBrains Mono. All colours are tokens in `packages/design-system/src/tokens/colors.css`, and app CSS uses only `var()` and `color-mix()` on them. Text tokens meet WCAG AA on every surface.
- **three.js scenes:** these are in `apps/web/src/three`.
  - A drifting constellation behind the app.
  - A distorted hero orb on the login page.
  - A 3D model galaxy plotting cost × quality × latency.
  - An allocation orb whose arc lengths are the portfolio's shares.
- **Scene behaviour:** every scene is lazy-loaded, caps device pixel ratio, pauses when the tab is hidden, and renders a single still frame for `prefers-reduced-motion`. It falls back to a static gradient without WebGL, or if the scene crashes.
- **Accessibility of 3D content:** 3D is never the only way to read data. The galaxy has a 2D chart and a table twin.
- **Galaxy labels:** these are plain DOM elements positioned by projecting 3D anchors each frame. drei's `<Html>` was dropped: it creates nested React roots that crash on unmount under React 19.
- **Chart palette:** the categorical palette is the dataviz reference palette's dark steps, validated against the chart surface (`#121622`). All checks pass, including adjacent CVD ΔE ≥ 8.4 and contrast ≥ 3:1. Colour follows the provider everywhere: catalogue cards, allocation rows, orb rings, risk bars and charts.

## 11. Domain additions

- **Model data:** models gain `latency_ms`, `reliability` (30-day %) and `deprecation_date`. All are nullable, and the UI shows "Not available" when a source doesn't publish them.
- **Scoring weights:** quality, cost, latency and reliability. Any non-negative mix is accepted and normalised. The default (0.6, 0.4, 0, 0) reproduces the original rule exactly, which is tested. A missing latency or reliability scores a neutral 0.5, so it's neither rewarded nor punished.
- **Provider risk:**
  - Concentration is measured with the Herfindahl–Hirschman Index over request share, using the conventional bands: ≥ 1,500 is moderate and ≥ 2,500 is high.
  - Lifecycle risk covers retired models (high) and models retiring within 90 days (moderate).
  - Overall risk is the worse of the two.
- **What-if scenarios:** price change by percent (one model or every model from a provider), model deprecation, and provider outage. Each run returns three views:
  - **Today:** the current allocation.
  - **Keep:** the same allocation under the scenario. Shares whose models disappear are spread proportionally over the survivors.
  - **Re-optimised:** a fresh recommendation against the changed catalogue.
- **Golden cost cases:** 17 cases with hand-worked arithmetic (`golden-cases.ts`) form the primary evaluation metric.

## 12. Ingestion and data quality

- **Feed format:** `{ source, generatedAt, models: [...] }`, with one record per model (see `data/sample-feed.json`). Records are matched on provider + name + version.
- **Source restrictions:** FILE sources are confined to the data folder. HTTP sources must be https, unless `ALLOW_HTTP_SOURCES=true` (used only by the tests). Feeds are capped at 5 MB with a 15 s timeout.
- **Transactions:** each record is applied in its own transaction through the same repository methods as admin edits, so history rows are always written. A record's counts, changes and alerts only take effect if its transaction commits.
- **Review rules:**
  - A price move of more than 50%, or a benchmark move of more than 15 points, is applied but flagged for review.
  - A new model without benchmark scores is not added.
  - An invalid record is rejected.
  - A failed source fails the run.
  - All of these create data-quality issues, at most one open issue per model and kind, and alert the admins.
- **Freshness:** an hourly check flags available models that no source has confirmed in 24 h. The flag clears automatically on the next confirmation. The sample feed runs every 60 minutes.
- **Scheduling:** with Redis, jobs run through a BullMQ queue and a separate worker, and API instances run with `SCHEDULER=off`. Without Redis, an in-process ticker runs them in single-instance development.

## 13. Alerts

- **Channel:** in-app only, via the bell menu and `/notifications`. Email and push would need an outside provider, which the proposal doesn't require.
- **Owner alerts:** after every catalogue change, owners of affected portfolios are told about:
  - a cost change of 1% or more;
  - a newly crossed budget;
  - a retirement;
  - a newly announced retirement within 90 days.
- **Admin alerts:** admins hear about failed ingestion runs and data-quality issues.
- **Live costs:** saved portfolios now report **current** costs. The cost at save time is kept alongside (`savedEstimatedCost`), and the UI shows when prices have moved since saving.

## 14. Operations, security and evaluation

- **Metrics:** request metrics are per process and in memory: p50, p95 and max per route, the 5xx share, and uptime. They feed the Operations tab and the evaluation dashboard. See `docs/evaluation.md` for how each proposal metric is measured.
- **Security:**
  - Helmet headers (`default-src 'none'` on the API), and a strict CSP in nginx.
  - Rate limiting on login and registration (20 per minute per IP).
  - The role is read from the database on every request.
  - Every resource is checked for ownership, and other users' resources return 404.
- **Encoding:** `migrate` refuses a non-UTF-8 database. The old dev database was WIN1252, which couldn't store "→" in issue messages; it was moved aside to `.pgdata-win1252-backup`.
- **Dates:** date-only values (retirement dates) are formatted in UTC so they don't shift by a day.
- **Staging:** there's no hosting account, so "CD to staging" works like this. CI publishes images to GHCR, boots the full compose stack from them on every push to `main`, then smoke-tests and load-tests it before tearing it down. The same compose file runs on any Docker host.
- **Load test:** it reports p97.5 rather than p95 (autocannon's percentile set). That's the stricter of the two.
- **Dependency audit:** CI checks shipped dependencies at high severity. The remaining moderate findings are in dev-only tooling (ESLint, autocannon).

# Phase 3: live data, two-colour HUD design, Vercel

Where this section conflicts with anything above, **this section wins**.

## 15. Live data (supersedes the sample-data default)

- **Source:** OpenRouter's public `GET /api/v1/models` (no key needed), registered by the seed as the `OPENROUTER` ingestion source "OpenRouter live catalogue". It's scheduled hourly in self-hosted setups and daily on Vercel Hobby (§17).
- **Field mapping:**
  - Prices are per token, multiplied by 10⁶ to give USD per 1M tokens, converted exactly to `numeric(12,4)`.
  - `context_length` maps directly.
  - Input modalities and supported parameters become capabilities (vision, audio, tool use, structured output and others).
  - `expiration_date` becomes the retirement date.
- **Benchmarks:** these are Artificial Analysis's coding index and intelligence index, as republished by OpenRouter. Models without a coding index aren't added, because there's nothing to score them on. The intelligence index is published for only some models, so `reasoning_score` is now **nullable** (migration 016). Quality is then the coding index alone, and the UI says "Not published".
- **Excluded listings:** free and other variant ids (containing `:`), `~` aliases, `openrouter/` routers, and variable or zero prices.
- **Reliability:** the best `uptime_last_1d` across a model's provider endpoints (`/models/{id}/endpoints`), so it's the 24-hour figure, not 30 days. If an endpoint lookup fails, the stored value is kept.
- **Latency:** not published, so it stays null. It scores a neutral 0.5 and the UI shows "Not available".
- **Matching:** models are matched on `external_id` (`openrouter:<id>`) first, then provider + name + version. Renames and provider moves follow the id.
- **Removed models:** a model that disappears from the feed is retired and gets a `MODEL_REMOVED` issue. As a guard, no run retires more than 25% of the catalogue, and an empty response retires nothing.
- **Sample data:** the illustrative catalogue remains for tests and offline demos (`SEED_SAMPLE=true`, which CI's e2e job uses for deterministic journeys). The staging job and Vercel seed live data.
- **Attribution:** the footer and the About page credit OpenRouter and Artificial Analysis, with no affiliation implied.

## 16. Visual design: two colours, HUD grid (supersedes §10)

- **Theme:** on request, the dark "galaxy" theme was replaced by a light, modern one inspired by hud.ai's layout language. It has:
  - fixed hairline rails framing the content column;
  - full-width seams with "+" crosshairs centred on the rails;
  - a faint 6-column measurement grid that fades below the fold;
  - hairline "bento" cells;
  - an Instrument Serif display face over Inter and JetBrains Mono.
- **Two colours only:** violet `#6b4eff` and cyan `#06b6d4`, plus neutrals. Every other tint is an OKLab mix of the two (`color-mix(in oklab, …)` in CSS, `gradientAt` / `gradientSteps` in JS).
  - **Parts of a whole** (allocations, provider shares) are gradient steps, always labelled in text. There is no categorical palette any more, which is why identity never relies on colour alone.
  - **Magnitudes** (quality in the scatter) are gradient positions, with a gradient legend.
  - **Status** maps good to cyan, caution to the midpoint and problem to violet, always with an icon (✓ ⚠ ✕) and a word.
- **3D:** the four three.js scenes were removed. One scene remains: `DotWave`, an undulating point grid on the login and dashboard heroes, coloured along the gradient. It's lazy-loaded, still under reduced motion, paused when hidden, and degrades to the static background without WebGL.
- **Workflow showcase:** `Workflow.tsx` shows the product's five-step workflow on the login and dashboard pages. Each step has a small animated mock of its screen, using real top models on the dashboard. It auto-advances every 3.6 s, pauses on hover, focus or click, doesn't auto-advance under reduced motion, and uses tablist semantics.
- **Scatter:** only the efficient frontier (no model is both cheaper and better) is labelled, since the live catalogue has over 100 models. The axes use explicit log ticks and a clamped quality range.

## 17. Hosting on Vercel + Neon

- **Why not GitHub Pages:** Pages serves static files only, and the app needs its API and database. Vercel hosts both the static web app and the Fastify API as one serverless function, with Neon providing PostgreSQL.
- **Build (`scripts/vercel-build.mjs`):** this writes the Build Output API layout directly, so nothing depends on framework detection.
  - **Web app:** built into `static/`.
  - **API:** bundled with esbuild from `apps/api/src/vercel.ts`. Runtime dependencies are traced with `@vercel/nft`, which picks the right native argon2 binary on Vercel's Linux builders.
  - **Function settings:** Node 22, 60 s maximum duration.
  - **Database:** when `DATABASE_URL` is present, the build runs `migrate` and `seed`. It uses `DATABASE_URL_UNPOOLED` when Neon provides it. The seed is idempotent and also refreshes the live catalogue.
  - **Safety checks:** on Vercel the build refuses to run without a ≥ 32-character `JWT_SECRET` and a real `SEED_ADMIN_PASSWORD` (≥ 12 characters, not the dev default).
- **Routing:**
  - `/api/<path>` is rewritten to the function as `/api?__pf_path=<path>`. The function restores the path (`src/serverless.ts`), so it works whatever URL the platform passes in.
  - Static files are served next; everything else falls back to `index.html`.
  - The same security headers and CSP as the nginx config apply.
- **Scheduled work:**
  - Vercel Cron calls `GET /api/cron/run` with `Authorization: Bearer $CRON_SECRET`. This runs every due source plus the freshness check. The endpoint returns 404 when no `CRON_SECRET` is configured, and compares secrets in constant time.
  - Hobby plans allow one cron run a day, so the schedule is daily at 06:00 UTC. On Pro it can be hourly.
  - Admins can also press "Run now"; the live sync takes about 5 s.
- **Serverless trade-offs:**
  - No Redis or worker, so jobs run inline.
  - The cache is in memory per instance, with a 5-minute TTL, so another instance can serve catalogue reads up to 5 minutes stale after an edit.
  - Operations metrics are per instance.
  - The database pool is capped at 3 connections per instance.
- **Region:** the function runs in the Vercel region nearest the Neon database. The build derives it from the database hostname (`ap-south-1` gives `bom1`, `us-east-1` gives `iad1`, and so on); set `FUNCTION_REGION` to override. The first deploy ran in `iad1` against a Mumbai database at about 210 ms per query; each request makes several queries, so co-locating them matters more than anything else.
- **Deploy-time sync:** the seed syncs the live catalogue only when the source is due, meaning its last run is older than its schedule. Redeploys in quick succession don't repeat the slow cross-region first sync.
