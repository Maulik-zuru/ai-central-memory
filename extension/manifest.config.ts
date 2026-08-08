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
      matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*', 'https://claude.ai/*', 'https://gemini.google.com/*'],
      js: ['src/content/index.tsx'],
      run_at: 'document_idle',
    },
  ],
  permissions: ['storage', 'scripting'],
  host_permissions: [
    // Overridden to http://localhost:4000/* in dev via vite.config.ts's mode check — this is the
    // production API origin placeholder.
    'https://api.aimemory.example/*',
    'http://localhost:4000/*',
  ],
});
