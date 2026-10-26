import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'logo.png'],
      manifest: {
        name: 'Pocket Pasal | पकेट पसल',
        short_name: 'Pocket Pasal',
        description: 'पकेट पसल: सामान, बिक्री र उधारो खाता',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f4f6fb',
        theme_color: '#1e56b0',
        lang: 'ne',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { navigateFallback: '/index.html' },
    }),
  ],
})
