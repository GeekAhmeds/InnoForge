// Builds the browser demo (real UI + sample data) into docs/presentation/demo.
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer/demo'),
  base: './',
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  plugins: [react()],
  // Escape non-ASCII in the bundle (the markdown parser contains U+FFFD literals).
  esbuild: { charset: 'ascii' },
  build: {
    outDir: resolve(__dirname, '../../docs/presentation/demo'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000
  }
})
