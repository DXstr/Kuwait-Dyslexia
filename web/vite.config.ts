import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import { readAuthConfig } from './src/auth/config.ts'
import { readScorerConfig } from './src/scorer/config.ts'
import { ar } from './src/i18n/messages.ts'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: 'browser-safe-auth-configuration',
      config: () => {
        const environment = loadEnv(mode, process.cwd(), 'VITE_')
        readAuthConfig(environment)
        readScorerConfig(environment)
      },
    },
    {
      name: 'arabic-shell-metadata',
      transformIndexHtml: (html) => html
        .replace('__APP_TITLE__', ar.appTitle)
        .replace('__APP_DESCRIPTION__', ar.appDescription),
    },
    ...(mode === 'production'
      ? [
          VitePWA({
            registerType: 'prompt',
            injectRegister: 'auto',
            includeAssets: [
              'icons/icon.svg',
              'pwa-192x192.png',
              'pwa-512x512.png',
              'maskable-512x512.png',
              'licenses/noto-naskh-arabic.txt',
              'brand/gold-eye.webp',
              'brand/kuwait-scenery.webp',
              'brand/noor/welcome.webp',
              'brand/noor/listening.webp',
              'brand/noor/teaching.webp',
              'brand/noor/reading.webp',
              'brand/noor/celebrating.webp',
              'brand/noor/encouraging.webp',
              'brand/noor/curious.webp',
              'fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-Regular.woff2',
              'fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-Medium.woff2',
              'fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-SemiBold.woff2',
              'fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-Bold.woff2',
              'fonts/ibm-plex-sans-arabic/OFL.txt',
            ],
            manifest: {
              id: '/',
              name: ar.appTitle,
              short_name: ar.appName,
              description: ar.appDescription,
              lang: 'ar',
              dir: 'rtl',
              start_url: '/',
              scope: '/',
              display: 'standalone',
              orientation: 'any',
              theme_color: '#35287A',
              background_color: '#FFF7EA',
              icons: [
                { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
                { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
                { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
            },
            workbox: {
              // Explicit static-shell allowlist: future content/audio/reports must
              // not silently enter a broad recursive precache glob.
              globPatterns: [
                'index.html',
                'registerSW.js',
                'assets/*.{js,css,woff2}',
              ],
              navigateFallback: 'index.html',
              navigateFallbackDenylist: [
                /^\/(?:api|supabase|auth|rest|storage|functions|realtime)(?:[/?]|$)/,
                /^\/(?:health|score-item|fingerprint|probe|stage0\/score)(?:[/?]|$)/,
                /^\/(?:audio|reports)(?:[/?]|$)/,
              ],
              cleanupOutdatedCaches: true,
              clientsClaim: false,
              skipWaiting: false,
            },
          }),
        ]
      : []),
  ],
  test: {
    clearMocks: true,
    restoreMocks: true,
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'e2e/**'],
  },
}))
