import { Alert } from '@pf/design-system';
import { RECOMMENDATION_CONFIG, RISK_THRESHOLDS, SCORING_WEIGHTS } from '@pf/domain';
import { ButtonLink, PageHead } from '../app/controls';

const pct = (w: number) => `${Math.round(w * 100)}%`;

export function AboutScreen() {
  return (
    <>
      <PageHead title="How it works" subtitle="How we estimate costs, score models and build a recommendation." />
      <div className="pf-prose">
        <Alert variant="info" title="Live data">
          The catalogue is synced every hour from public sources — see <a href="#data">Data sources</a> below. Prices are list prices; check a provider before you commit spend.
        </Alert>

        <h2 id="start">Getting started</h2>
        <p>Browse the catalogue and compare a few models. Then describe a workload: a typical request, how many you send each month, and your budget. We recommend a mix of models, which you can adjust and save as a portfolio.</p>
        <p>This app never sends your prompts to a model provider. It reasons only over the catalogue.</p>

        <h2 id="costs">How costs are calculated</h2>
        <p>Prices are quoted in US dollars per million tokens. The monthly cost of a model’s share of a workload is:</p>
        <code className="pf-code">{'(input tokens × input price + output tokens × output price) ÷ 1,000,000\n  × requests per month × share of the workload'}</code>
        <p>Every cost in the app — the estimate while you type, the recommendation, each allocation and the breakdown — uses this one calculation.</p>

        <h2 id="scores">How models are scored</h2>
        <p>Each model has a coding index and, where published, an intelligence index — both from Artificial Analysis, on a 0–100 scale. Its quality score is the average of the two, or the coding index alone when no intelligence index is published. By default, when we rank models for a workload, quality counts for {pct(SCORING_WEIGHTS.quality)} and cost for {pct(SCORING_WEIGHTS.cost)}: the cheapest model that qualifies gets full marks for cost, the most expensive gets none.</p>
        <p>You can change those priorities per workload and add latency (faster is better) and reliability (24-hour uptime of the model’s best route). When a source doesn’t publish a figure — latency isn’t public today — that factor scores every model in the middle, so missing data neither helps nor hurts.</p>

        <h2 id="risk">Provider risk</h2>
        <p>
          Each portfolio gets a concentration score — the Herfindahl–Hirschman Index of how its requests are split across providers, from near 0 (spread thin) to 10,000 (one provider). From {RISK_THRESHOLDS.moderateHhi.toLocaleString('en-US')} it counts as moderate, from {RISK_THRESHOLDS.highHhi.toLocaleString('en-US')} as high. Models that are retired, or due to retire within {RISK_THRESHOLDS.deprecationWarningDays} days, raise the risk too.
        </p>

        <h2 id="what-if">What-if scenarios</h2>
        <p>On a saved portfolio you can simulate a price rise or cut, a model being deprecated, or a whole provider going down. You see today’s position, what happens if you change nothing, and a fresh recommendation for the changed world.</p>

        <h2 id="alerts">Alerts and data freshness</h2>
        <p>Catalogue figures are refreshed from data feeds on a schedule; large or suspicious changes are flagged for an administrator to review. When a change moves the cost of one of your saved portfolios, pushes it over budget, or retires one of its models, you get an alert.</p>

        <h2 id="recommendations">How recommendations work</h2>
        <p>
          We consider only available models with a context window large enough for your requests and every capability you asked for. The {RECOMMENDATION_CONFIG.portfolioSize} best-ranked models share the workload in proportion to their score. If that’s over budget, we move {RECOMMENDATION_CONFIG.adjustmentStep}% at a time from the most expensive model to the cheapest until it fits.
        </p>
        <p>If no mix fits, we suggest the cheapest model that meets your requirements and tell you how far over budget it is. The same inputs always produce the same recommendation.</p>

        <h2 id="data">Data sources</h2>
        <ul>
          <li>
            <strong>Prices, context windows, capabilities, retirement dates and uptime</strong> — the <a href="https://openrouter.ai/docs/api-reference/list-available-models" target="_blank" rel="noreferrer">OpenRouter public models API</a>. Prices are OpenRouter’s list price per token, shown per 1M tokens (base tier; long-context surcharges aren’t modelled). Uptime is the best route’s last 24 hours.
          </li>
          <li>
            <strong>Coding and intelligence indices</strong> — <a href="https://artificialanalysis.ai" target="_blank" rel="noreferrer">Artificial Analysis</a>, as published through the OpenRouter API. Models without a coding index aren’t listed.
          </li>
        </ul>
        <p>The catalogue refreshes every hour. Moves of more than 50% in price or 15 points in an index are applied but flagged for an administrator; models that leave the source are retired, with their history kept. This app isn’t affiliated with either source.</p>
        <div>
          <ButtonLink to="/workload">Define workload</ButtonLink>
        </div>
      </div>
    </>
  );
}
