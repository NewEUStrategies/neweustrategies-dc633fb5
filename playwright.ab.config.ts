// Konfiguracja Playwrighta dla POMIARU PORÓWNAWCZEGO pierwszego wczytania.
//
// TRZECIA konfiguracja w tym repozytorium i każda z nich odpowiada na inne
// pytanie - stąd trzy, a nie flagi w jednej:
//   * `playwright.config.ts`          - czy funkcje DZIAŁAJĄ (dev-server);
//   * `playwright.artifact.config.ts` - czy ARTEFAKT żyje i mieści się w progach;
//   * ten plik                        - CZY ZMIANA przyspieszyła wczytywanie.
//
// DLACZEGO PORT, ETYKIETA I TRASA IDĄ Z ENV. Ten sam plik obsługuje OBA drzewa
// porównania (bazowe i mierzone), bo różnica w konfiguracji byłaby odczytana
// jako różnica w produkcie - a to jest dokładnie ten błąd, przed którym cały
// ten pomiar ma chronić. Dwa różne porty, bo oba serwery stoją równolegle.
//
// `testDir: "./e2e-ab"` - osobny katalog, żeby `testDir: "./e2e"` pozostałych
// dwóch konfiguracji nie mógł tego specu podnieść. Uzasadnienie w nagłówku
// `e2e-ab/bootCompare.spec.ts`, bramka w `playwrightConfigParity.test.ts`.
import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Ta sama detekcja przeglądarki co w dwóch pozostałych konfiguracjach - sandbox
// trzyma Chromium w /opt/pw-browsers i nigdy nie wołamy `playwright install`.
const LOCAL_CHROMIUM = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/opt/pw-browsers/chromium/chrome-linux/chrome",
  "/opt/ms-playwright/chromium-1194/chrome-linux/chrome",
  "/opt/ms-playwright/chromium/chrome-linux/chrome",
].find((candidate): candidate is string => typeof candidate === "string" && existsSync(candidate));

const PORT = Number(process.env.NES_AB_PORT ?? 4193);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e-ab",
  fullyParallel: false,
  // JEDEN worker i ZERO powtórzeń - to pomiar, nie test. Drugi worker mierzyłby
  // serwer obsługujący pierwszego, a powtórzenie po cichu podmieniłoby próbkę
  // na tę z mniej obciążonej maszyny.
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["line"]],
  use: {
    baseURL: BASE_URL,
    ...devices["Desktop Chrome"],
    launchOptions: LOCAL_CHROMIUM ? { executablePath: LOCAL_CHROMIUM } : {},
  },
  webServer: {
    command: "node .output/server/index.mjs",
    url: BASE_URL,
    // NIGDY nie przejmujemy cudzego serwera. `true` pozwoliłoby zmierzyć serwer
    // z POPRZEDNIEJ połowy porównania i oddać różnicę zero przy realnej zmianie
    // - czyli awarię tego pomiaru w jego najcichszej postaci.
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORT: String(PORT), HOST: "127.0.0.1", NODE_ENV: "production" },
  },
});
