import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // The service worker caches the app itself so it opens with no signal.
    // Data is kept in IndexedDB by src/local, not by the service worker.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Site Inspection',
        short_name: 'Site',
        description: 'Site issues, inspections and evidence.',
        display: 'standalone',
        start_url: '/',
        background_color: '#f7f9fa',
        theme_color: '#0c6a86',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { navigateFallback: 'index.html', navigateFallbackDenylist: [/^\/v1\//, /^\/l\//] },
    }),
  ],
  // host: listen on 127.0.0.1 explicitly. "localhost" can resolve to the IPv6 address only, which GitHub Codespaces'
  // port forwarding cannot reach, and the page then fails with "can't currently handle this request".
  // allowedHosts: answer on a Codespaces forwarded address.
  server: { host: '127.0.0.1', proxy: { '/v1': 'http://127.0.0.1:3000' }, allowedHosts: ['.app.github.dev'] },
  preview: { host: '127.0.0.1', proxy: { '/v1': 'http://127.0.0.1:3000' }, allowedHosts: ['.app.github.dev'] },
  test: { environment: 'node', setupFiles: ['fake-indexeddb/auto'] },
});
