import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the browser talks to Vite, which forwards /api to the backend.
// Same origin, so no CORS setup is needed. Point elsewhere with AEGIS_API_PROXY.
const apiTarget = process.env.AEGIS_API_PROXY ?? 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: apiTarget } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: apiTarget } },
  },
})
