import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  // In development, /api calls are forwarded to the FastAPI server.
  server: { proxy: { '/api': 'http://localhost:8000' } },
  build: { chunkSizeWarningLimit: 1200 },
})
