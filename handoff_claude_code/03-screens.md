# 3. Screens

Eight screens. Each lists layout, states and validation. Copy is user-facing — **no schema or implementation language anywhere in the UI**.

Tier names below map to the design system as set out in `02-design-system.md`: **primary** = `Button variant="primary"`, **secondary** = `Button variant="ghost"`, **tertiary** = `TextLink as="button"`, **selected** = `Button variant="accent"`. Cards are `Card`, chips are `FilterChip`, tables are `Table` inside your own scroll wrapper.

---

## 3.1 Login / Register

Centred card, max 440px. Fields: Email, Password (+ Name when registering). Primary button full width. Footer line toggles between modes.

- **Validation:** email must contain `@`; name ≥ 2 chars on register. Errors render in `--pf-negative` above the button.
- **The demo-mode role switch below the card is prototype-only. Delete it.** In production, role comes from the account.

## 3.2 Model catalogue

Header: page title + muted "N of M models · prices per 1M tokens" line. Right: search field + **Compare (n)** primary button (disabled below 2 selections).

Capability chips filter the grid. Cards (auto-fill, min 280px) show provider overline, model name + version, a 2×2 stat grid (input/output price, coding/reasoning score), context window, and two actions: **Details** (tertiary) + **Add to compare** (secondary → `selected` state when on). Selected cards get a 2px `--future-blue` outline.

Below the grid: three `Stat` figures.

- **Empty state:** if search/filter yields nothing, show "No models match" with a tertiary "Clear filters".
- Retired models show a `Retired` tag in `--pf-negative` and are excluded from recommendations.

## 3.3 Model detail

Provider overline, title, muted status + context line. Four `Stat` figures. Capability list as `Badge variant="topic"`. History table (price and score over time). Actions: **Back to catalogue** (tertiary), **Add to compare** (primary / `selected`).

## 3.4 Compare

Matrix table: one column per selected model, rows for provider, version, prices, context, scores, overall, status, then one row per capability (tick / dash).

- **Fewer than 2 selected:** show a prompt + primary "Go to catalogue".

## 3.5 Define workload

Two columns. Left card: workload name, input tokens/request, output tokens/request, requests/month, monthly budget, capability chips. Actions: **Calculate cost and recommend** (primary), **Reset capabilities** (tertiary).

Right column: live **eligible models** count and a **single-model cost estimate** list (cheapest four, over-budget entries in `--pf-negative`), plus "cheapest option uses X% of the budget".

- **Validation on submit:** every numeric field > 0 and a non-empty name. Errors render inline under each field; nothing downstream runs on invalid input.

## 3.6 Recommendation / Portfolio

**Banner** — a solid `--future-blue` surface when within budget, `--pf-negative` when over: headline, plain-language reason, and three metrics — estimated monthly cost, workload budget, models allocated.

**Left column:** "Allocation" section header + **Normalise to 100%** (tertiary). Each row: model name · provider, monthly cost, percentage, remove ×, and one full-width slider. Below: "Add an eligible model" with secondary buttons. Then "Cost breakdown" table (allocation, input cost, output cost, monthly cost, plus a Total row).

**Right panel:** portfolio name, portfolio budget, three validation rows, the **blended benchmark score** (shown here only — never duplicated in the banner), **Save portfolio** (primary, disabled until all three validations pass), and the muted line "Saves this portfolio and its model allocations."

Validation rows: allocation totals 100% · total cost within budget · at least one model. Tick in `--pf-positive`, cross in `--pf-negative`.

- **No recommendation yet:** title + primary "Define workload".

## 3.7 Admin console

Overline "Admin console", page title, muted description. `Tabs` with two panels: **Models & pricing**, **Providers**.

Models tab: a grid with columns model / input price / output price / coding / reasoning / status / save. Fields are inline number inputs; the row's Save button is disabled until the row is dirty. Saving shows an `Alert variant="success"` naming the model.

Providers tab: provider cards with model counts, plus a name field and **Add provider** (primary).

## 3.8 Footer

Three link columns (Analysis, Data, Support). **No internal/dev links.** One legal line: "Demo build · sample data, not a live price list" — remove or replace at launch.
