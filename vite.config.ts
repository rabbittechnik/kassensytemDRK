import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'DLRG Kasse',
        short_name: 'DLRG Kasse',
        description: 'Touch-Kassensystem für DLRG-Veranstaltungen (offline)',
        theme_color: '#0a0e17',
        background_color: '#05080f',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2}'],
      },
    }),
  ],
})
