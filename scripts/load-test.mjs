// Load test for proposal §6.2 "API responsiveness: common dashboard requests
// complete within ~2 seconds under pilot load".
//
//   API_URL=http://127.0.0.1:3001 node scripts/load-test.mjs
//
// Logs in once (credentials from SEED_ADMIN_* or the dev defaults), then drives
// each common read endpoint with concurrent clients. Fails (exit 1) if any
// endpoint's 97.5th-percentile latency exceeds the target or more than 1% of
// responses are not 2xx. autocannon reports p97.5, which is stricter than p95.
import autocannon from 'autocannon';

const BASE = (process.env.API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const TARGET_MS = Number(process.env.TARGET_MS ?? 2000);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 10); // pilot: 5–10 users
const DURATION = Number(process.env.DURATION ?? 10);

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.test', password: process.env.SEED_ADMIN_PASSWORD ?? 'dev-admin-password' }),
});
if (!login.ok) {
  console.error(`Login failed (${login.status}). Is the API running at ${BASE} and seeded?`);
  process.exit(1);
}
const { token } = await login.json();
const headers = { authorization: `Bearer ${token}` };

const endpoints = ['/models', '/providers', '/analytics/overview', '/analytics/cost-quality', '/portfolios', '/notifications?limit=6'];
const results = [];
for (const path of endpoints) {
  const r = await autocannon({ url: BASE + path, headers, connections: CONNECTIONS, duration: DURATION });
  const non2xx = r.non2xx + r.errors + r.timeouts;
  results.push({
    endpoint: path,
    requests: r.requests.total,
    'req/s': Math.round(r.requests.average),
    'p50 ms': r.latency.p50,
    'p97.5 ms': r.latency.p97_5,
    'max ms': r.latency.max,
    'non-2xx': non2xx,
    pass: r.latency.p97_5 <= TARGET_MS && non2xx <= r.requests.total * 0.01,
  });
}
console.table(results);
const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`FAIL: ${failed.map((f) => f.endpoint).join(', ')} missed the ${TARGET_MS} ms / 1% error target.`);
  process.exit(1);
}
console.log(`PASS: every endpoint p97.5 ≤ ${TARGET_MS} ms with ${CONNECTIONS} concurrent clients.`);
