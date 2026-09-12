import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
const artifactRoot = process.env.NES_PERFORMANCE_ARTIFACT_ROOT ?? process.cwd();
const measurementCase = process.env.NES_CMS_PERFORMANCE_CASE ?? "manual";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export default defineConfig({
  testDir: "./e2e-performance",
  testMatch: "cms-widgets.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: `test-results-cms-performance/${measurementCase}`,
  reporter: [["list"], ["json", { outputFile: `reports/cms-playwright/${measurementCase}.json` }]],
  use: {
    baseURL: "http://127.0.0.1:4192",
    trace: "retain-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `node --import ${shellQuote(resolve("scripts/performance/replayCmsFetch.mjs"))} .output/server/index.mjs`,
    cwd: artifactRoot,
    port: 4192,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: "4192",
      HOST: "127.0.0.1",
      NITRO_PORT: "4192",
      NITRO_HOST: "127.0.0.1",
      SUPABASE_URL: "http://127.0.0.1:4199",
      SUPABASE_PUBLISHABLE_KEY: "performance-fixture",
      SUPABASE_SERVICE_ROLE_KEY: "performance-fixture-admin",
    },
  },
});
