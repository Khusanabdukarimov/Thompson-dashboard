import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Mirrors the production nginx routing so dev is same-origin and needs no CORS.
    // Order matters: the Node (:3001) prefixes must precede the catch-all '/api'.
    proxy: {
      '/api/dashboard': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/api/campaigns': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/api/reja': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/api/marketing': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/webhook': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
