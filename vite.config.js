import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Relative base for portability
  server: {
    // Enable proxy for API requests during development
    proxy: {
      '/api': {
        target: 'http://localhost:8000', // Forward API calls to PHP server
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/api') // Keep /api prefix
      }
    }
  }
})
