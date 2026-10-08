import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import seo from './vite.seo.js';

// `vite build --mode static` swaps the API client for an in-browser mock so the
// page can be hosted without the Node server (demo only).
export default defineConfig(({ mode }) => ({
  plugins: [react(), seo()],
  resolve: mode === 'static'
    ? { alias: [{ find: /^\.\/api\.js$/, replacement: path.resolve('src/api.static.js') }] }
    : {},
  build: mode === 'static'
    ? { outDir: 'dist-static' }
    : { rollupOptions: { input: { main: path.resolve('index.html'), admin: path.resolve('admin.html') } } },
  server: {
    proxy: { '/api': `http://localhost:${process.env.PORT || 8787}` },
  },
}));
