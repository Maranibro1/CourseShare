import { defineConfig, devices } from '@playwright/test';

/*
 * Two builds are tested:
 * - "local": the app on its own, data on the device (vite preview, port 4173);
 * - "sync":  the app talking to the sync server (port 4174), with each test
 *            using separate browser contexts as separate phones.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    ...devices['Pixel 7'],
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'local', testIgnore: /sync\.spec\.ts/, use: { baseURL: 'http://localhost:4173' } },
    { name: 'sync', testMatch: /sync\.spec\.ts/, use: { baseURL: 'http://localhost:4174' } },
  ],
  webServer: [
    {
      command: 'npm run build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command:
        'rm -rf .e2e-data && VITE_SYNC=server VITE_APK_URL=/downloads/kazikwanza.apk npx vite build --outDir .e2e-web --emptyOutDir && mkdir -p .e2e-web/downloads && echo test > .e2e-web/downloads/kazikwanza.apk && npm run build:server && PORT=4174 STATIC_DIR=.e2e-web DATA_DIR=.e2e-data node dist-server/index.js',
      url: 'http://localhost:4174/api/health',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
