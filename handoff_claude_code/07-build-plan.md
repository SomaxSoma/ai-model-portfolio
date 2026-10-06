# 7. Build plan

Order chosen so something is demoable after every step.

### Step 1 — Schema + seed
Migrations in the order in `05-data-model.md`. Seed providers and models from `ui_kits/portfolio-app/catalogue.jsx` (**clearly flagged as sample data**).
*Checkpoint:* `GET /models` returns eight models with prices and scores.

### Step 2 — Auth
Register, login, hashed passwords, `role` on the token. Server-side admin guard.
*Checkpoint:* a USER token is rejected by `POST /providers`.

### Step 3 — Cost + eligibility library
Port `monthlyCost`, `eligibleModels`, `overallScore` as a standalone module with unit tests **before** any UI.
*Checkpoint:* tests cover zero-budget, no-eligible-models, and equal-cost (`maxCost == minCost`) cases.

### Step 4 — Catalogue UI
Catalogue, detail, compare. Load the design-system bundle first (`02-design-system.md`) and compose from its components — get the card style, type scale and three button tiers right once, now.
*Checkpoint:* one primary button per screen; supporting text is visibly muted.

### Step 5 — Workload + recommendation
Workload form with server validation, then the engine endpoint. Include the budget-adjustment loop and the infeasible case.
*Checkpoint:* an impossible budget returns a helpful `reason`, not an error.

### Step 6 — Portfolio editing
Allocation sliders (one track — see `02`), live cost breakdown, three validations, save.
*Checkpoint:* Save is disabled until allocation is exactly 100% and within budget; the server re-checks both.

### Step 7 — Admin console
Inline editing with the history-write transaction.
*Checkpoint:* changing an input price changes the next recommendation.

### Step 8 — Responsive + a11y pass
Nav collapse at 1080px, tables stacking at 760px, focus-visible rings, labelled sliders and icon buttons, 4.5:1 text contrast.

## Things that will bite you

1. **Two cost implementations.** If the preview and the engine disagree by a cent, users lose trust. One function.
2. **Rounding allocations.** Three rounded percentages rarely total 100 — push the drift onto the top-scored model.
3. **The denormalised price columns** drifting from history. One repository method, one transaction.
4. **Slider double-track.** If you reach for a native range input plus a progress bar, you will rebuild exactly the bug this design fixed.
5. **`Table` clips silently.** The design system's `Table` renders its own `overflow-x: hidden` wrapper, so a wide table loses its right-hand columns with no scrollbar. Wrap it. Releasing only `overflow-x` computes back to `auto` while the other axis is hidden — release both.
6. **Redefining a design-system token.** Aliasing `--accent`, `--hairline` or `--success` in app CSS re-skins the bundle's own components. Prefix app names.
7. **A wide child stretching the page.** Grid tracks default to `min-width: auto`, so one 900px-wide panel widens the whole document. Pin scrolling containers to `minmax(0, 1fr)`.
8. **Role in the client.** Navigation branches on role; authorisation must not.
