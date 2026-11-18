import { defineConfig, devices } from '@playwright/test';

/*
 * Two builds are tested:
 * - "local": the app on its own, data on the device (vite preview, port 4173);
 * - "sync":  the app talking to the sync server (port 4174), with each test
 *            using separate browser contexts as separate phones.
 */
// Optional third build: the app talking to Supabase (a real project or a local Supabase stack).
// KAZI_E2E_SUPABASE_URL=http://127.0.0.1:54321 KAZI_E2E_SUPABASE_KEY=<anon key> npm run test:e2e
const supabaseUrl = process.env.KAZI_E2E_SUPABASE_URL;
const supabaseKey = process.env.KAZI_E2E_SUPABASE_KEY ?? '';

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
    ...(supabaseUrl ? [{ name: 'supabase', testMatch: /sync\.spec\.ts/, use: { baseURL: 'http://localhost:4175' } }] : []),
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
    ...(supabaseUrl
      ? [
          {
            command: `VITE_SUPABASE_URL=${supabaseUrl} VITE_SUPABASE_ANON_KEY=${supabaseKey} VITE_APK_URL=/downloads/kazikwanza.apk npx vite build --outDir .e2e-web-supabase --emptyOutDir && mkdir -p .e2e-web-supabase/downloads && echo test > .e2e-web-supabase/downloads/kazikwanza.apk && npx vite preview --outDir .e2e-web-supabase --port 4175 --strictPort`,
            url: 'http://localhost:4175',
            reuseExistingServer: false,
            timeout: 180_000,
          },
        ]
      : []),
  ],
});
