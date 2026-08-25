import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 5177,
      strictPort: false,
      proxy: { '/api': { target: env.VITE_FLOYD_DFS_DEV_URL ?? 'http://127.0.0.1:3000', changeOrigin: true } },
    },
  }
})
