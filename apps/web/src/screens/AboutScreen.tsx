import { Alert } from '@pf/design-system';
import { RECOMMENDATION_CONFIG, SCORING_WEIGHTS } from '@pf/domain';
import { ButtonLink, PageHead } from '../app/controls';

const pct = (w: number) => `${Math.round(w * 100)}%`;

export function AboutScreen() {
  return (
    <>
      <PageHead title="How it works" subtitle="How we estimate costs, score models and build a recommendation." />
      <div className="pf-prose">
        <Alert variant="warning" title="Sample data">
          The catalogue in this build is illustrative. Model names, prices and benchmark scores are examples, not a live price list.
        </Alert>

        <h2 id="start">Getting started</h2>
        <p>Browse the catalogue and compare a few models. Then describe a workload: a typical request, how many you send each month, and your budget. We recommend a mix of models, which you can adjust and save as a portfolio.</p>
        <p>This app never sends your prompts to a model provider. It reasons only over the catalogue.</p>

        <h2 id="costs">How costs are calculated</h2>
        <p>Prices are quoted in US dollars per million tokens. The monthly cost of a model’s share of a workload is:</p>
        <code className="pf-code">{'(input tokens × input price + output tokens × output price) ÷ 1,000,000\n  × requests per month × share of the workload'}</code>
        <p>Every cost in the app — the estimate while you type, the recommendation, each allocation and the breakdown — uses this one calculation.</p>

        <h2 id="scores">How models are scored</h2>
        <p>Each model has a coding score and a reasoning score from 0 to 100. Its overall score is the average of the two. When we rank models for a workload, quality counts for {pct(SCORING_WEIGHTS.quality)} and cost for {pct(SCORING_WEIGHTS.cost)}: the cheapest model that qualifies gets full marks for cost, the most expensive gets none.</p>

        <h2 id="recommendations">How recommendations work</h2>
        <p>
          We consider only available models with a context window large enough for your requests and every capability you asked for. The {RECOMMENDATION_CONFIG.portfolioSize} best-ranked models share the workload in proportion to their score. If that’s over budget, we move {RECOMMENDATION_CONFIG.adjustmentStep}% at a time from the most expensive model to the cheapest until it fits.
        </p>
        <p>If no mix fits, we suggest the cheapest model that meets your requirements and tell you how far over budget it is. The same inputs always produce the same recommendation.</p>

        <h2 id="data">About the sample data</h2>
        <p>Administrators maintain prices and scores in the admin console. Every change is kept in the model’s history. Before this app is used for real decisions, the sample catalogue must be replaced with data from a licensed, attributed source.</p>
        <div>
          <ButtonLink to="/workload">Define workload</ButtonLink>
        </div>
      </div>
    </>
  );
}
