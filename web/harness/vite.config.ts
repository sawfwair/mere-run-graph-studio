import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite config for the visual harness (see ./README.md). Serves the real editor
// shell against a mock runtime so it can be viewed / screenshotted without a
// Tauri or cloud backend. Not part of any shipped bundle.
export default defineConfig({
  root: 'web/harness',
  publicDir: '../public',
  plugins: [react()],
  define: { __MERE_GRAPH_STUDIO_CLOUD__: 'true' },
  server: { host: '127.0.0.1', port: 1433, strictPort: true },
});
