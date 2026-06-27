import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Use the sandbox's pre-installed Chromium when present (PLAYWRIGHT_BROWSERS_PATH
// points browsers at /opt/pw-browsers; we never run `playwright install` here).
// CI installs its own matching browser via `playwright install chromium`.
const LOCAL_CHROMIUM = [
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/opt/pw-browsers/chromium/chrome-linux/chrome",
].find(existsSync);

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    ...(LOCAL_CHROMIUM ? { launchOptions: { executablePath: LOCAL_CHROMIUM } } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Run the app via the dev server. The production build targets the Cloudflare
  // edge runtime (a Worker, not a Node server) and `vite preview` is incompatible
  // with it, so the dev server is the portable way to drive the real SSR app in
  // CI. (Supabase data is unavailable under placeholder creds; the specs are
  // written to be backend-agnostic.)
  webServer: {
    command: `bun run dev --host 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
