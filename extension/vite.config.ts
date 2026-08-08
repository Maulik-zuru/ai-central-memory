import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  server: {
    port: 5175,
    strictPort: true,
    // CRXJS's HMR websocket needs a fixed, predictable origin the extension's manifest expects.
    hmr: { port: 5175 },
  },
});
