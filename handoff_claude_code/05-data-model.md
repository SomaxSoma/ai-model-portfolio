# 5. Data model (PostgreSQL)

Nine tables, 3NF, surrogate PKs throughout. Full ER diagram: `docs/uml/er-diagram.md`.

## Tables

| Table | Key columns | Notes |
|---|---|---|
| `USER` | `user_id` PK, `email` UNIQUE, `password_hash`, `role` | `role` is `'USER' | 'ADMIN'` — no separate admin table |
| `PROVIDER` | `provider_id` PK, `name` UNIQUE, `website`, `description` | |
| `AI_MODEL` | `model_id` PK, `provider_id` FK, `name`, `version`, `context_window`, `input_price`, `output_price`, `coding_score`, `reasoning_score`, `status` | Current price + headline scores live here as a **read optimisation** |
| `BENCHMARK` | `benchmark_id` PK, `model_id` FK, scores, `source`, `recorded_at` | Append-only |
| `PRICING_HISTORY` | `history_id` PK, `model_id` FK, prices, `source`, `recorded_at` | Append-only |
| `WORKLOAD` | `workload_id` PK, `user_id` FK, tokens, `requests_per_month`, `budget`, `required_capabilities` jsonb | |
| `PORTFOLIO` | `portfolio_id` PK, `user_id` FK, `name`, `budget` | |
| `PORTFOLIO_MODEL` | `portfolio_model_id` PK, `portfolio_id` FK, `model_id` FK, `allocation_percentage`, `estimated_cost` | **Junction with attributes** |
| `RECOMMENDATION` | `recommendation_id` PK, `workload_id` FK, `portfolio_id` FK NULLABLE, `estimated_cost`, `score`, `reason` | `portfolio_id` fills in when the user accepts |

## Constraints

- `UNIQUE (portfolio_id, model_id)` on `PORTFOLIO_MODEL` — a model cannot be allocated twice in one portfolio.
- `CHECK (allocation_percentage BETWEEN 0 AND 100)`.
- `ON DELETE CASCADE`: `USER → WORKLOAD`, `USER → PORTFOLIO`, `PORTFOLIO → PORTFOLIO_MODEL` (true composition).
- `ON DELETE RESTRICT`: `PROVIDER → AI_MODEL` — never silently lose catalogue history.
- Money columns: `numeric(12,4)`. Never float.

## Denormalisation contract

`AI_MODEL.input_price`, `output_price`, `coding_score` and `reasoning_score` duplicate the newest `PRICING_HISTORY` / `BENCHMARK` rows. **Whenever you insert a history row, update the model row in the same transaction.** Write it once, in one repository method.

## Migration order

`USER` → `PROVIDER` → `AI_MODEL` → (`BENCHMARK`, `PRICING_HISTORY`) → `WORKLOAD` → `PORTFOLIO` → `PORTFOLIO_MODEL` → `RECOMMENDATION`.
