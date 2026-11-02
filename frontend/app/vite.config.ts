import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
// DEV_API_TARGET=https://<live site> npm run dev — preview local UI changes against the live
// API (read-only browsing) when no local backend is running.
const remote = process.env.DEV_API_TARGET
const to = (local: string) => ({ target: remote || local, changeOrigin: true, secure: true })

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
      '/api/dashboard': to('http://127.0.0.1:3001'),
      '/api/campaigns': to('http://127.0.0.1:3001'),
      '/api/reja': to('http://127.0.0.1:3001'),
      '/api/marketing': to('http://127.0.0.1:3001'),
      '/webhook': to('http://127.0.0.1:3001'),
      '/api': to('http://127.0.0.1:8000'),
    },
  },
})
