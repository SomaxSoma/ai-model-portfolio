# 6. REST API

One API surface; the client never touches a service or the database directly. Reference: `docs/uml/component-diagram.md`.

## Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/register` | name, email, password | 201 user + token |
| POST | `/auth/login` | email, password | 200 user + token |

`role` is returned on the user object and drives client navigation. Authorise admin routes **server-side** — never trust the client's role.

## Catalogue (read: any authenticated user)

| Method | Path | Notes |
|---|---|---|
| GET | `/providers` | |
| GET | `/models` | `?capability=&search=&status=` |
| GET | `/models/{id}` | Includes benchmark + pricing history |

## Catalogue (write: ADMIN only)

| Method | Path | Notes |
|---|---|---|
| POST | `/providers` | |
| POST | `/models` · PATCH `/models/{id}` | A price or score change also writes a history row — same transaction |

## Workloads & recommendations

| Method | Path | Notes |
|---|---|---|
| POST | `/workloads` | Validates server-side; 400 with per-field errors |
| GET | `/workloads` | Current user's |
| POST | `/workloads/{id}/recommendation` | Runs eligibility → cost → score → allocation → budget loop; **persists before returning**; 201 |
| GET | `/recommendations/{id}` | Re-open without recomputing |

## Portfolios

| Method | Path | Notes |
|---|---|---|
| POST | `/portfolios` | Body includes allocation lines |
| GET/PATCH | `/portfolios/{id}` | |
| DELETE | `/portfolios/{id}` | Cascades allocation lines |

## Rules

- **Validation is server-side and authoritative.** The client's inline validation is a convenience mirror.
- Allocation totalling 100% and within-budget are enforced on write — reject with 422 and a field-level message.
- Return money as decimal strings, not floats.
