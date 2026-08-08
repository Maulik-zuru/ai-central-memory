// import.meta.env.DEV is Vite's standard build-mode flag — true for `vite dev`, false for
// `vite build`. Swap API_BASE_URL for the real production origin before shipping to the Chrome
// Web Store; it must match manifest.config.ts's host_permissions entry exactly.
export const API_BASE_URL = import.meta.env.DEV ? "http://localhost:4000" : "https://api.aimemory.example";
