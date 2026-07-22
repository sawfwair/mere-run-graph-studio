import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  define: { __MERE_GRAPH_STUDIO_CLOUD__: 'false' },
  build: {
    outDir: '../dist/desktop',
    emptyOutDir: true,
    sourcemap: true,
    // The editor is one offline application shell; its React + XYFlow runtime
    // is intentionally loaded together. Keep a real budget without emitting a
    // generic 500 kB warning for the measured ~600 kB desktop entry.
    chunkSizeWarningLimit: 650,
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
});
