import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // registered explicitly in src/main.jsx instead
      // favicon.ico and apple-touch-icon.png aren't referenced by the
      // manifest's icons array (that's Android/Chrome-specific), so they
      // need to be listed explicitly to be precached as part of the
      // offline app shell. icon-192/512/512-maskable are covered
      // automatically since they're already in manifest.icons below.
      includeAssets: [
        'favicon.ico',
        'icons/favicon-16.png',
        'icons/favicon-32.png',
        'icons/apple-touch-icon.png',
      ],
      manifest: {
        name: 'Music Scene Magazine Gig Calendar',
        short_name: 'MSM Gig Calendar',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0d0d0d',
        theme_color: '#0a0a0a',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      }
    }
  }
})
