import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    fs: { allow: ['..'] },
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const host = req.headers.host;
            if (host) proxyReq.setHeader('x-forwarded-host', host);
          });
          proxy.on('proxyReqWs', (proxyReq, req) => {
            const host = req.headers.host;
            if (host) proxyReq.setHeader('x-forwarded-host', host);
          });
        },
      },
      '/api': {
        target: 'http://localhost:3001',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const host = req.headers.host;
            if (host) proxyReq.setHeader('x-forwarded-host', host);
          });
        },
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../client-dist'),
    emptyOutDir: true,
  },
});
