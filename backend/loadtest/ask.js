import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

/**
 * Load profile for POST /api/ask — the most compute-heavy path in the system (Backend_Plan.md
 * Phase 12). One Ask fans out across memories, chat history, and files concurrently, then calls
 * the LLM provider once for synthesis.
 *
 * Run against a staging-like environment, NOT as part of PR CI (a full run takes minutes and
 * would make every commit slow):
 *   k6 run -e BASE_URL=https://staging.example.com -e TOKEN=<access-token> backend/loadtest/ask.js
 *
 * Seed the target account with a realistic corpus first — running this against an empty account
 * measures the empty-result path, not retrieval, and would report a flatteringly wrong number.
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const TOKEN = __ENV.TOKEN;

const askLatency = new Trend('ask_latency', true);

export const options = {
  stages: [
    { duration: '20s', target: 5 },  // ramp
    { duration: '60s', target: 20 }, // sustained: the profile the budget below is stated against
    { duration: '10s', target: 0 },  // ramp down
  ],
  thresholds: {
    // The budget. p95 under 3s for a path that includes a real LLM round-trip; error rate under 1%.
    // These are this phase's first stated numbers, to be revisited against production telemetry —
    // not inherited from anywhere, and deliberately written down rather than left implicit.
    'http_req_duration{expected_response:true}': ['p(95)<3000'],
    http_req_failed: ['rate<0.01'],
  },
};

const QUESTIONS = [
  'what did we decide about the database?',
  'summarise what I know about the launch date',
  'what were the deployment preferences discussed?',
  'which client is the current project for?',
];

export default function () {
  if (!TOKEN) throw new Error('Set -e TOKEN=<access token> to run this script');

  const question = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
  const res = http.post(
    `${BASE_URL}/api/ask`,
    JSON.stringify({ question, mode: 'all' }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } },
  );

  askLatency.add(res.timings.duration);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'answer present': (r) => {
      try {
        return typeof r.json('message.content') === 'string';
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}
