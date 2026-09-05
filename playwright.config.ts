import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Use the sandbox's pre-installed Chromium when present (PLAYWRIGHT_BROWSERS_PATH
// points browsers at /opt/pw-browsers; we never run `playwright install` here).
// CI installs its own matching browser via `playwright install chromium`.
const LOCAL_CHROMIUM = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/opt/pw-browsers/chromium/chrome-linux/chrome",
  "/opt/ms-playwright/chromium-1194/chrome-linux/chrome",
  "/opt/ms-playwright/chromium/chrome-linux/chrome",
].find((candidate): candidate is string => typeof candidate === "string" && existsSync(candidate));

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // SPECY ARTEFAKTOWE NIE JADĄ TĄ KONFIGURACJĄ - i to musi być WYMUSZONE, nie
  // tylko napisane. `playwright.artifact.config.ts` twierdził w nagłówku, że
  // `boot-artifact` i `boot-timing` są „uruchamiane WYŁĄCZNIE przez tę
  // konfigurację, nigdy przez zwykłe `bun run test:e2e`" - i było to
  // nieprawdziwe, bo `testDir` bierze cały katalog. Zmierzone na runnerze
  // (przebieg 33512138275, job `e2e`): oba specy pojechały po DEV-SERVERZE
  // i padły dokładnie tak, jak muszą - `readyMs` 19 963 ms wobec budżetu 6 000
  // (dev nie ma chunków, boot idzie przez kompilację kilkuset modułów ESM),
  // `staticGraphCount` = 0 („dokument nie pobrał domknięcia statycznego" - bo
  // w dev domknięcia statycznego NIE MA), a sonda uznała boot za martwy po
  // 15 001 ms. To nie jest awaria produktu; to pomiar wykonany na czymś, czego
  // ten pomiar nie dotyczy.
  //
  // Wzorzec jest DOKŁADNIE tym samym, co `testMatch` w
  // `playwright.artifact.config.ts`, a parytet obu pilnuje bramka
  // `src/lib/ci/__tests__/playwrightConfigParity.test.ts` - bez niej rozjazd
  // dwóch plików konfiguracyjnych znowu byłby niewidoczny do pierwszego
  // czerwonego przebiegu.
  testIgnore: /boot-(artifact|timing|home)\.spec\.ts$/,
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
