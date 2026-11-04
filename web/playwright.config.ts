import { defineConfig, devices } from '@playwright/test'

// Test-only public key for an intercepted loopback API. No live service accepts
// this unsigned synthetic key; it is never a production runtime fallback.
const syntheticAnon = `${Buffer.from('{}').toString('base64url')}.${Buffer.from('{"role":"anon"}').toString('base64url')}.synthetic`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'on-first-retry' },
  projects: [
    {
      name: 'chromium',
      testMatch: 'scaffold.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'mocked-auth-sdk',
      testMatch: /(?:auth|assessment|learning-map|parent-report|stage0)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        baseURL: 'http://127.0.0.1:4174',
        permissions: ['microphone'],
        launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
      },
    },
    {
      name: 'real-mode-scorer-http',
      testMatch: /(?:scorer|review)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, baseURL: 'http://127.0.0.1:4175' },
    },
  ],
  webServer: [
    {
      command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_SCORER_MODE: 'mock', VITE_SCORER_URL: '' },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174',
      env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54329', VITE_SUPABASE_ANON_KEY: syntheticAnon, VITE_SCORER_MODE: 'mock', VITE_SCORER_URL: 'http://127.0.0.1:54328' },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4175 --strictPort',
      url: 'http://127.0.0.1:4175',
      env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54329', VITE_SUPABASE_ANON_KEY: syntheticAnon, VITE_SCORER_MODE: 'real', VITE_SCORER_URL: 'http://127.0.0.1:54328' },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
