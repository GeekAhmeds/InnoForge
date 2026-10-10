import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the built files load from file:// inside Electron.
// The dev server injects an inline React Refresh preamble, so relax the CSP only there.
const devCsp = {
  name: 'dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
};

export default defineConfig({
  base: './',
  plugins: [react(), devCsp],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
