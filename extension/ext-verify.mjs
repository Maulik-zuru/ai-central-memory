import { chromium } from "playwright";
import path from "path";

const EXT = path.resolve("dist");
const ctx = await chromium.launchPersistentContext("/tmp/ext-profile-" + Date.now(), {
  executablePath: "/opt/pw-browsers/chromium",
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"],
});

// The MV3 service worker registering at all is the first real proof the manifest is loadable.
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 });
const extId = new URL(sw.url()).host;
console.log("1. service worker registered, extension id:", extId);

sw.on("console", (m) => console.log("   SW:", m.type(), m.text()));

// Register a dashboard account the extension will pair against.
const email = `ext-${Date.now()}@example.com`;
const page = await ctx.newPage();
await page.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
await page.fill('input[type="email"]', email);
await page.fill('input[type="password"]', "Str0ngPassw0rd");
await page.click('button[type="submit"]');
await page.waitForURL("**/dashboard**", { timeout: 20000 });
console.log("2. dashboard account created:", email);

// Drive PAIRING_START through the real background worker.
const started = await sw.evaluate(async () => {
  const res = await chrome.runtime.sendMessage({ type: "PAIRING_START" });
  return res;
});
console.log("3. PAIRING_START ->", JSON.stringify(started).slice(0, 120));

const code = started?.data?.code;
if (!code) { console.log("FAILED: no pairing code"); await ctx.close(); process.exit(1); }

// Claim it from the dashboard, exactly as the popup's opened tab does.
await page.goto(`http://localhost:3000/dashboard/settings/api-keys?pair=${code}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
console.log("4. dashboard claim page visited");

const polled = await sw.evaluate(async (c) => chrome.runtime.sendMessage({ type: "PAIRING_POLL", code: c }), code);
console.log("5. PAIRING_POLL ->", polled?.data?.status);

const state = await sw.evaluate(async () => chrome.runtime.sendMessage({ type: "GET_CONNECTION_STATE" }));
console.log("6. GET_CONNECTION_STATE ->", JSON.stringify(state?.data));

await page.screenshot({ path: "/tmp/ext-dashboard.png" });
await ctx.close();
console.log("DONE");
