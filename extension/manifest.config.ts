import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

// Manifest V3. host_permissions is scoped to the API's own origin only — content scripts never
// call the API directly (see docs/Phase8_BrowserExtension_Implementation_Plan.md §4); they relay
// through the background service worker, which is the only context holding this permission.
export default defineManifest({
  manifest_version: 3,
  name: 'AI Memory & Context',
  description: 'Save, recall, and inject your memory context into any AI chat tool.',
  version: pkg.version,
  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  action: {
    default_popup: 'src/popup/index.html',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      // Phase 22: Grok and DeepSeek added as marker-line-only platforms — narrowly scoped to
      // their own domains (not the shared x.com origin, which would run this on all of Twitter/X).
      matches: [
        'https://chatgpt.com/*',
        'https://chat.openai.com/*',
        'https://claude.ai/*',
        'https://gemini.google.com/*',
        'https://grok.com/*',
        'https://chat.deepseek.com/*',
      ],
      js: ['src/content/index.tsx'],
      run_at: 'document_idle',
    },
  ],
  // 'alarms' drives the durable half of pairing (background/pairing.ts) — the action popup closes
  // the instant the dashboard tab it opens takes focus, so nothing in the pairing flow may depend
  // on a popup-owned timer surviving that.
  permissions: ['storage', 'scripting', 'alarms'],
  // Must cover whatever origin src/lib/config.ts actually targets for the build being produced,
  // or every background fetch fails with a permission error. Both are listed so a local build
  // (npm run build:local) and a production build load from the same manifest.
  host_permissions: ['https://api.aimemory.example/*', 'http://localhost:4000/*'],
});
