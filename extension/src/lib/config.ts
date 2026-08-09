/**
 * Build-time configuration.
 *
 * Previously this keyed off `import.meta.env.DEV`, which is only true for the `vite dev` server —
 * NOT for `vite build`, and not even for `vite build --mode development` (Vite forces
 * NODE_ENV=production for any build). The consequence was that NO build of this extension could
 * be pointed at a local backend: every loadable artifact hardcoded the production origin, so the
 * extension could not be tested end-to-end against a dev stack at all.
 *
 * Both values are therefore explicit env vars with production defaults:
 *
 *   npm run build                                    -> production origins
 *   npm run build:local                              -> localhost origins, loadable in Chrome
 *
 * DASHBOARD_URL is separate from API_BASE_URL rather than derived from it. It used to be computed
 * as API_BASE_URL.replace("http://localhost:4000", "http://localhost:3000"), which is a no-op in a
 * production build — pairing would have opened https://api.aimemory.example/dashboard/... (the API
 * origin, which serves no dashboard) instead of the real one, breaking the connect flow for every
 * real user while working perfectly in local dev.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'https://api.aimemory.example';

export const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL ?? 'https://app.aimemory.example';
