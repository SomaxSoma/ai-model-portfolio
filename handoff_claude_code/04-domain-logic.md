# 4. Domain logic

Port these exactly. Reference: `ui_kits/portfolio-app/catalogue.jsx`.

## 4.1 Cost

Prices are quoted **per 1,000,000 tokens**.

```
monthlyCost(model, workload, sharePercent = 100) =
  ((workload.inputTokens  * model.inputPrice
  + workload.outputTokens * model.outputPrice) / 1_000_000)
  * workload.requestsPerMonth
  * (sharePercent / 100)
```

**One cost function for the whole app.** The workload preview, the recommendation, the allocation rows and the breakdown table all call it. Do not reimplement it per screen.

Use a decimal type (not float) for money in the database; `numeric(12,4)` is sufficient.

## 4.2 Eligibility

A model is eligible for a workload when **all** hold:

1. `model.status = 'ACTIVE'`
2. `model.contextWindow >= workload.inputTokens + workload.outputTokens`
3. every capability in `workload.requiredCapabilities` is present in `model.capabilities`

## 4.3 Scoring

```
overallScore(model) = round((codingScore + reasoningScore) / 2)     // 0..100

costNorm(i) = maxCost == minCost
            ? 1
            : 1 - (cost[i] - minCost) / (maxCost - minCost)          // 0..1

score(i) = 0.6 * (overallScore(model[i]) / 100) + 0.4 * costNorm(i)
```

The 60/40 quality:cost split is a product decision — expose it as a config constant, not a magic number.

## 4.4 Allocation

1. Sort eligible models by `score` descending; take the top **3**.
2. Allocation % per model = `round(score / sumOfScores * 100)`.
3. Add any rounding drift to the highest-scoring model so the total is exactly 100.

## 4.5 Budget adjustment loop

```
while (totalCost > workload.budget && steps < 20):
    donor = allocation entry with the highest full cost
    if donor is the cheapest entry or donor.percent <= 5: break
    donor.percent   -= 5
    cheapest.percent += 5
    recompute totalCost
    steps++
```

**Termination:** every iteration strictly lowers total cost, and the all-cheapest allocation is the floor. If that floor still exceeds the budget, return the closest feasible allocation with `withinBudget = false` and an explanatory reason — never fail silently and never return an empty result.

Drop any entry that reaches 0%.

## 4.6 Result

```
{
  allocations: [{ model, allocationPercentage, estimatedCost }],
  estimatedCost, // sum
  score,         // allocation-weighted blended benchmark
  withinBudget,
  adjusted,      // true if the loop ran
  reason         // plain-language, user-facing
}
```

`reason` is shown verbatim in the UI — write it in user language, never in schema terms.

**No eligible models:** return an empty allocation with `reason` telling the user which constraint to relax.
