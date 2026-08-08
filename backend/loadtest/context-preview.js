import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Load profile for POST /api/context/preview — the Smart Memory retrieval engine (Phase 4).
 * Measured separately from Ask because the two have genuinely different cost profiles: this path
 * is a single vector search plus scoring with a short-TTL cache in front, where Ask fans out
 * across three sources and makes an LLM call. One shared budget would flatter this path and
 * unfairly penalise the other.
 *
 *   k6 run -e BASE_URL=... -e TOKEN=... backend/loadtest/context-preview.js
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const TOKEN = __ENV.TOKEN;

export const options = {
  stages: [
    { duration: '20s', target: 10 },
    { duration: '60s', target: 40 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    // Tighter than Ask's: no LLM call on this path, so p95 is dominated by the vector search that
    // Phase 12's HNSW index exists to keep sub-linear.
    'http_req_duration{expected_response:true}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

// Varied snippets on purpose: identical ones would be served from retrieval.service's 60s cache
// after the first hit and the run would measure cache throughput rather than retrieval.
const SNIPPETS = [
  'working on the deployment pipeline today',
  'planning the client kickoff meeting',
  'reviewing database schema decisions',
  'writing the launch announcement',
  'debugging the sync job failures',
];

export default function () {
  if (!TOKEN) throw new Error('Set -e TOKEN=<access token> to run this script');

  const snippet = `${SNIPPETS[Math.floor(Math.random() * SNIPPETS.length)]} ${__VU}-${__ITER}`;
  const res = http.post(
    `${BASE_URL}/api/context/preview`,
    JSON.stringify({ snippet }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } },
  );

  check(res, {
    'status is 200': (r) => r.status === 200,
    'token accounting present': (r) => {
      try {
        return typeof r.json('actualTokens') === 'number';
      } catch {
        return false;
      }
    },
  });

  sleep(0.5);
}
