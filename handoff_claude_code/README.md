# Claude Code Handoff — AI Model Portfolio Intelligence Platform

**What this is:** an implementation package for a decision-support web app that compares AI models on pricing, benchmarks and capabilities, then assembles an optimised **model portfolio** inside a monthly budget.

**What it is NOT:** an API gateway. The platform never routes prompts to a provider. It reasons over a stored catalogue.

## Read in this order

| # | File | Why |
|---|---|---|
| 1 | `01-product-spec.md` | Domain, actors, MVP scope, the boundary of what NOT to build |
| 2 | `02-design-system.md` | Tokens, type scale, the three button tiers, component inventory |
| 3 | `03-screens.md` | Screen-by-screen spec with states, validation and empty/error cases |
| 4 | `04-domain-logic.md` | Cost, eligibility and recommendation algorithms — exact formulas |
| 5 | `05-data-model.md` | PostgreSQL schema, constraints, migrations order |
| 6 | `06-api.md` | REST endpoints, payloads, status codes |
| 7 | `07-build-plan.md` | Suggested implementation order with checkpoints |

## Reference implementation

The working click-through prototype is in this repo at `ui_kits/portfolio-app/`. It is **UI-truth, not code-truth**: React function components with session-only state, loaded through a dev-time JSX loader. Read it for layout, interaction and copy; do not port its loading mechanism.

| Prototype file | What to take from it |
|---|---|
| `PortfolioApp.jsx` | Navigation model, role gating, screen routing |
| `AuthScreen.jsx` | Login/register layout; the demo-mode role switch is prototype-only — delete it |
| `ModelsScreen.jsx` | Catalogue grid, search, capability chips, compare selection |
| `ModelDetailScreen.jsx` | Detail layout and history table |
| `CompareScreen.jsx` | Comparison matrix |
| `WorkloadScreen.jsx` | Form, live eligibility count, per-model cost preview |
| `PortfolioScreen.jsx` | Recommendation banner, allocation sliders, validation, cost breakdown |
| `AdminScreen.jsx` | Inline-editable catalogue table |
| `catalogue.jsx` | **The algorithms.** Port these formulas exactly — see `04-domain-logic.md` |
| `ds.jsx` | Handle on the design-system bundle + the one local input control |
| `AppNav.jsx` | Application top bar (the design system ships no nav) |
| `theme.css` | `--pf-*` aliases, app layout classes, slider and input — **no colour literals** |

## Design system

The prototype loads the bound **Website Design System** bundle and composes from its components. `02-design-system.md` lists what is used, what the system does not ship, and the token rules. Do not re-create its components.

## Design diagrams

`docs/uml/` holds six Mermaid diagrams (use case, class, sequence, activity, component, ER) that this package summarises. They render on GitHub.

## Assumptions a developer must confirm

1. **Catalogue data is sample data.** Prices, benchmark scores and the generic model names ("GPT-class Frontier") are illustrative. Real data needs a licensed/attributed source before launch.
2. **No auth provider chosen.** The spec assumes email+password with a `role` column; swap in your identity provider if you have one.
3. **Currency is USD only**, prices quoted per 1M tokens. Multi-currency is not modelled.
4. **The recommendation engine is deterministic and rule-based** by design (see `04`). No ML model is involved.
5. **Benchmark scores are a single 0–100 number per axis.** If your source gives raw eval results, you need a normalisation step that does not exist yet.
