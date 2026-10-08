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
  // allowedHosts lets the dev server answer on a GitHub Codespaces forwarded address.
  server: { proxy: { '/v1': 'http://localhost:3000' }, allowedHosts: ['.app.github.dev'] },
  preview: { proxy: { '/v1': 'http://localhost:3000' } },
  test: { environment: 'node', setupFiles: ['fake-indexeddb/auto'] },
});
