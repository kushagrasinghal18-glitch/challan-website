import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// `vite build --mode static` swaps the API client for an in-browser mock so the
// page can be hosted without the Node server (demo only).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: mode === 'static'
    ? { alias: [{ find: /^\.\/api\.js$/, replacement: path.resolve('src/api.static.js') }] }
    : {},
  build: mode === 'static' ? { outDir: 'dist-static' } : {},
  server: {
    proxy: { '/api': `http://localhost:${process.env.PORT || 8787}` },
  },
}));
