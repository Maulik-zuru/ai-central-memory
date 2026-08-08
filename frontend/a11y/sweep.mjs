import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

/**
 * Scripted WCAG 2.1 AA sweep over the app's key routes (docs/Phase12_Implementation_Plan.md §6.2).
 *
 *   node a11y/sweep.mjs                        # against a locally running dev server
 *   BASE_URL=https://staging... node a11y/sweep.mjs
 *
 * Requires both servers running and a seeded account — an authenticated sweep is the point, since
 * almost every screen in this app is behind a login.
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const EMAIL = process.env.A11Y_EMAIL;
const PASSWORD = process.env.A11Y_PASSWORD || "Str0ngPassw0rd";

const PUBLIC_ROUTES = ["/login", "/register", "/pricing"];
const AUTHED_ROUTES = [
  "/dashboard",
  "/dashboard/memories",
  "/dashboard/buckets",
  "/dashboard/chat-history",
  "/dashboard/files",
  "/dashboard/ask",
  "/dashboard/intelligence",
  "/dashboard/settings",
  "/dashboard/settings/api-keys",
  "/dashboard/settings/sessions",
  "/dashboard/settings/privacy",
  "/dashboard/settings/smart-memory",
  "/dashboard/settings/billing",
];

// The standard this project committed to in Product_Requirements.md §8.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scan(page, route) {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return violations.map((v) => ({
    route,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
    sample: v.nodes[0]?.html?.slice(0, 120),
  }));
}

// Unset CHROMIUM_PATH lets Playwright resolve its own installed browser (the CI case); setting it
// pins a preinstalled binary (the sandboxed-dev case).
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
// An explicit context, not browser.newPage() — @axe-core/playwright injects its runner into every
// frame and requires one.
const context = await browser.newContext();
const page = await context.newPage();

const findings = [];
for (const route of PUBLIC_ROUTES) findings.push(...(await scan(page, route)));

if (EMAIL) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard**", { timeout: 15000 });
  for (const route of AUTHED_ROUTES) findings.push(...(await scan(page, route)));
} else {
  console.warn("A11Y_EMAIL not set — skipping authenticated routes (most of the app).");
}

await browser.close();

if (findings.length === 0) {
  console.log(`No WCAG 2.1 AA violations across ${PUBLIC_ROUTES.length + (EMAIL ? AUTHED_ROUTES.length : 0)} routes.`);
  process.exit(0);
}

console.error(`${findings.length} accessibility violation(s):\n`);
for (const f of findings) {
  console.error(`  [${f.impact}] ${f.route} — ${f.id}: ${f.help} (${f.nodes} node(s))`);
  if (f.sample) console.error(`      ${f.sample}`);
}
// Non-zero so CI fails on a regression rather than reporting into the void.
process.exit(1);
