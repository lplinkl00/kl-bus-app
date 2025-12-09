import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy Google Directions API requests to avoid CORS issues
      '/api/google-directions': {
        target: 'https://maps.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/google-directions/, '/maps/api/directions/json'),
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('Sending Request to the Target:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
          });
        },
      },
      // Proxy for cors-anywhere (alternative option)
      '/api/cors-proxy': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/cors-proxy/, ''),
      },
    },
  },
})
