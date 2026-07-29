import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// TODO (Sprint 1, blocked on revised ™ logo): the `icons` array below is
// intentionally left empty. Do not add icon entries or generate any icon
// files until the updated master artwork has been supplied -- see project
// notes. Manifest is otherwise complete and ready.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // registered explicitly in src/main.jsx instead
      manifest: {
        name: 'Music Scene Magazine Gig Calendar',
        short_name: 'MSM Gig Calendar',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0d0d0d',
        theme_color: '#0a0a0a',
        icons: [
          // Populated once the revised master logo (with (TM)) is
          // available -- see TODO above. Required before this manifest
          // passes an installability check.
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
