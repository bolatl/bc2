import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', timeout: 60_000, expect: { timeout: 10_000 }, fullyParallel: false, workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', channel: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    {
      command: 'go run ../cmd/server', url: 'http://localhost:18080/api/v1/couples/me',
      env: { ...process.env, ADDR: ':18080', FRONTEND_URL: 'http://localhost:5174', ALLOWED_ORIGINS: 'http://localhost:5174', LLM_API_KEY: '', LLM_PROVIDER: '', LLM_MODEL: '', LLM_BASE_URL: '', STRIPE_SECRET_KEY: '', COOKIE_SECURE: 'false', ENABLE_REHEARSAL: 'false', DISABLE_PAYWALL: 'false', FREE_TURNS: '4', MAX_TURNS: '12' },
      reuseExistingServer: false, timeout: 120_000, stdout: 'ignore', stderr: 'ignore',
    },
    {
      command: 'npm run dev -- --port 5174', url: 'http://localhost:5174',
      env: { ...process.env, VITE_API_ORIGIN: 'http://localhost:18080', VITE_LLM_MODE: 'mock', VITE_PAYMENT_MODE: 'mock' },
      reuseExistingServer: false, timeout: 60_000,
    },
  ],
});
