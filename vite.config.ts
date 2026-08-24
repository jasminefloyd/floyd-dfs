import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5177,
    strictPort: false,
    proxy: { '/api': { target: process.env.VITE_FLOYD_DFS_DEV_URL ?? 'https://dfs-engine-kappa.vercel.app', changeOrigin: true } },
  },
})
