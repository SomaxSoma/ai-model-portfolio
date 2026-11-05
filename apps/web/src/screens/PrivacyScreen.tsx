import { Link } from 'react-router';
import { PageHead } from '../app/controls';

/** Public: what the platform stores, why, for how long, and how to remove it. */
export function PrivacyScreen() {
  return (
    <div className="pf-prose" style={{ maxWidth: 760 }}>
      <PageHead overline={<span className="pf-eyebrow">Privacy &amp; data</span>} title="What we store, and for how long" />

      <h2 id="never">What we never do</h2>
      <p>Model Portfolio never sends your prompts or data to an AI provider — it only reasons over its catalogue of published prices and benchmarks. We don’t sell data, run ads or use third-party tracking or analytics. There are no cookies, apart from a short-lived one during Google or GitHub sign-in.</p>

      <h2 id="stored">What we store</h2>
      <ul>
        <li>
          <strong>Your account:</strong> name, email address, and a password hash (Argon2 — the password itself is never stored). If you sign in with Google or GitHub, we store that service’s account id instead of a password.
        </li>
        <li>
          <strong>What you create:</strong> workloads (token counts, volumes, budgets, priorities), recommendations, saved portfolios, alerts and any feedback ratings.
        </li>
        <li>
          <strong>In your browser:</strong> your sign-in token, comparison set and workload draft (local storage), so a refresh doesn’t lose them.
        </li>
        <li>
          <strong>Server logs:</strong> requests with their IP address, kept by the hosting platform for a short period for security and debugging.
        </li>
      </ul>

      <h2 id="retention">How long we keep it</h2>
      <ul>
        <li>Your account and what you create: until you delete them. Deleting a portfolio removes it immediately; deleting your account removes everything listed above.</li>
        <li>Demo accounts: removed automatically, with everything in them, within a day.</li>
        <li>Password-reset links: expire after 30 minutes and work once.</li>
      </ul>

      <h2 id="who">Who processes it</h2>
      <ul>
        <li>Hosting: Vercel (application) and Neon (PostgreSQL database).</li>
        <li>Email, only when it’s switched on: Resend sends password-reset emails and, if you opt in, alert digests.</li>
        <li>Sign-in, only if you choose it: Google or GitHub confirm your identity and email address.</li>
        <li>Catalogue data comes from OpenRouter’s public API. No information about you is sent to them.</li>
      </ul>

      <h2 id="control">Your controls</h2>
      <p>
        From <Link to="/account">your account</Link> you can change your name, turn email alerts on or off, and delete your account and all its data. Workloads and portfolios can be deleted one by one from their pages.
      </p>

      <h2 id="compliance">Compliance filters</h2>
      <p>The catalogue can be filtered by where each provider is headquartered. That’s where the company is based, not where a request is processed — check the provider’s own data-processing terms before relying on it for compliance.</p>
    </div>
  );
}
