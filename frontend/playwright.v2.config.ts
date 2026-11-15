import { defineConfig } from '@playwright/test';

// The v2 suite uses a separate in-memory, short-flow backend. It never loads .env
// or reuses an existing server, so local conversations and API keys stay untouched.
export default defineConfig({
  testDir: './e2e', testMatch: 'backend-v2.spec.ts',
  timeout: 60_000, expect: { timeout: 10_000 }, fullyParallel: false, workers: 1,
  reporter: [['list']], outputDir: 'test-results/backend-v2',
  use: { baseURL: 'http://localhost:5176', channel: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    {
      command: 'go run ../cmd/server', url: 'http://localhost:18082/api/v1/couples/me',
      env: {
        ...process.env, ADDR: ':18082', FRONTEND_URL: 'http://localhost:5176', ALLOWED_ORIGINS: 'http://localhost:5176',
        SESSION_SECRET: 'isolated-backend-v2-browser-tests-only',
        LLM_API_KEY: '', LLM_PROVIDER: '', LLM_MODEL: '', LLM_BASE_URL: '', STRIPE_SECRET_KEY: '',
        COOKIE_SECURE: 'false', ENABLE_REHEARSAL: 'false', DISABLE_PAYWALL: 'true',
        FUNNEL: 'short', ENABLE_CHECKPOINTS: 'true', DATA_FILE: '',
        FREE_TURNS: '4', MAX_TURNS: '12', DIVERGENCE_THRESHOLD: '4',
      },
      reuseExistingServer: false, timeout: 120_000, stdout: 'ignore', stderr: 'ignore',
    },
    {
      command: 'npm run dev -- --port 5176', url: 'http://localhost:5176',
      env: { ...process.env, VITE_API_ORIGIN: 'http://localhost:18082', VITE_LLM_MODE: 'mock', VITE_PAYMENT_MODE: 'disabled' },
      reuseExistingServer: false, timeout: 60_000,
    },
  ],
});
