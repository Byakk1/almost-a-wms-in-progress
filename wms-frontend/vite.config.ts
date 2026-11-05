import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/v1': {
        // Explicit IPv4: the API binds 127.0.0.1, while "localhost" can resolve
        // to ::1 on Windows and miss the listener.
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
