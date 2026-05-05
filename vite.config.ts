import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string }
const buildAtIso = new Date().toISOString()

// https://vite.dev/config/
export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_APP_BUILD_AT': JSON.stringify(buildAtIso),
  },
  server: {
    /** Wenn `VITE_API_BASE_URL=/api` und API lokal mit API_MOUNT_PATH=/api: Proxy zum Dev-Server */
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      /** Nutzer bestätigt Update (`useRegisterSW` / Workbox `waiting`). */
      registerType: 'prompt',
      includeAssets: [
        'favicon.svg',
        'icons/icon.svg',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-512-maskable.png',
        'icons/apple-touch-icon-180.png',
      ],
      manifest: {
        id: '/',
        name: 'DLRG Kasse',
        short_name: 'DLRG Kasse',
        description: 'Touch-Kassensystem für DLRG-Veranstaltungen (offline)',
        // DLRG-Farben: Rot als Theme, dunkler Splash-Hintergrund.
        theme_color: '#e30613',
        background_color: '#0b0b0f',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        lang: 'de',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2,webmanifest}'],
        // Cache nur App-Shell; API/Health/DATA nie aus SW-Cache bedienen.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/health$/, /^\/DATA(\/|$)/],
        clientsClaim: true,
        skipWaiting: false,
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) => {
              if (request.mode === 'navigate') return false
              const p = url.pathname
              return (
                p.startsWith('/api/') ||
                p === '/health' ||
                p === '/DATA' ||
                p.startsWith('/DATA/')
              )
            },
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^.*\/assets\/products\/.*\.(?:png|jpe?g|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'dlrg-products',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
        // Seed product PNGs exceed Workbox default 2 MiB precache limit
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
    }),
  ],
})
