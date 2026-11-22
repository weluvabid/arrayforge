import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: fileURLToPath(new URL('../../dist/benchmarks/browser', import.meta.url)),
    emptyOutDir: true,
  },
});
