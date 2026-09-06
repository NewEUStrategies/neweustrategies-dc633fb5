import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const artifactRoot = process.env.NES_PERFORMANCE_ARTIFACT_ROOT ?? process.cwd();
const port = 4192;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export default defineConfig({
  testDir: "./e2e/performance",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "test-results-performance",
  timeout: 30_000,
  expect: { timeout: 5000 },
  reporter: [["list"], ["json", { outputFile: "reports/first-visit-playwright.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], locale: "pl-PL" } }],
  webServer: {
    command: `node --import ${shellQuote(resolve("scripts/performance/replayFetch.mjs"))} .output/server/index.mjs`,
    cwd: artifactRoot,
    // TCP readiness does not warm the router before the measured request.
    port,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(port),
      HOST: "127.0.0.1",
      NITRO_PORT: String(port),
      NITRO_HOST: "127.0.0.1",
      SUPABASE_URL: "http://127.0.0.1:4199",
      SUPABASE_PUBLISHABLE_KEY: "performance-fixture",
      SUPABASE_SERVICE_ROLE_KEY: "performance-fixture-admin",
    },
  },
});
