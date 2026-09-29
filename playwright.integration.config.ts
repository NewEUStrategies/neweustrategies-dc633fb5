import { defineConfig, devices } from "@playwright/test";

// Explicitly invoked against a dedicated sandbox, never folded into mocked E2E.
if (process.env.EVENT_INTEGRATION_ACK !== "dedicated-sandbox") {
  throw new Error(
    "Set EVENT_INTEGRATION_ACK=dedicated-sandbox and configure the integration fixtures.",
  );
}
const baseURL = process.env.EVENT_INTEGRATION_BASE_URL;
if (!baseURL || new URL(baseURL).protocol !== "https:") {
  throw new Error("EVENT_INTEGRATION_BASE_URL must point to the HTTPS sandbox deployment.");
}
export default defineConfig({
  testDir: "./integration/events",
  testMatch: "paid-lifecycle.spec.ts",
  timeout: 240_000,
  expect: { timeout: 60_000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], baseURL, trace: "off", screenshot: "off", video: "off" },
});
