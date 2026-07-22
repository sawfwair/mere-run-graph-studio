import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  define: { __MERE_GRAPH_STUDIO_CLOUD__: 'true' },
  build: {
    outDir: '../cloud/dist',
    emptyOutDir: true,
    sourcemap: true,
    // Hosted Studio ships the same single editor shell as desktop. This budget
    // remains just above the measured entry and will warn on material growth.
    chunkSizeWarningLimit: 650,
  },
});
