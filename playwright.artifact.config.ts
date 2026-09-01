// Konfiguracja Playwrighta dla BOOT-TESTU NA ARTEFAKCIE PRODUKCYJNYM.
//
// PO CO OSOBNA KONFIGURACJA. `playwright.config.ts` startuje aplikację przez
// `bun run dev`, gdzie CHUNKÓW NIE MA Z DEFINICJI - a klasa awarii, którą ten
// test zamyka (cykl chunków -> wywrócona kolejność inicjalizacji -> boot padnie
// PRZED `hydrateRoot`, strona zostaje statycznym SSR-em bez żadnego objawu),
// jest niewykrywalna zarówno w dev, jak i w testach jednostkowych. Dokładnie to
// obiecuje komentarz w `vite.config.ts` przy `manualChunks`: „gate:
// scripts/check-chunk-graph.ts (cykle) + boot-test przeglądarkowy na buildzie
// vite.smoke.config.ts". Pierwsza połowa obietnicy była wdrożona od dawna,
// druga nie istniała - żaden skrypt nie budował tego configu, żaden workflow go
// nie wołał, żaden spec nie jechał po zbudowanym serwerze.
//
// `check:chunks` łapie WYŁĄCZNIE CYKLE. Artefakt bez cyklu też może paść przed
// hydratacją (interop CJS, brakujący eksport, rzut w chunku vendorowym) -
// i tylko prawdziwa przeglądarka na zbudowanym serwerze to zobaczy.
//
// DLACZEGO `node .output/server/index.mjs` TU DZIAŁA, a przy głównym buildzie
// nie: `vite.smoke.config.ts` celuje presetem `node-server` zamiast
// `cloudflare-module`, więc artefakt jest zwykłym serwerem Node. Artefakt
// produkcyjny (cloudflare-module) eksportuje moduł workera z `fetch(req, env,
// ctx)` i `node` go nie uruchomi - dlatego smoke config w ogóle istnieje.
//
// KOLEJNOŚĆ W CI JEST KONTRAKTEM: `bun run build:smoke` NADPISUJE `.output/`,
// więc musi biec PO `check:bundle`, `check:chunks` i `check:entry-purity`, które
// mierzą artefakt cloudflare'owy. Opisane w `.github/workflows/ci.yml`.
import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Ta sama detekcja przeglądarki co w `playwright.config.ts` - sandbox trzyma
// Chromium w /opt/pw-browsers i nigdy nie wołamy `playwright install`.
const LOCAL_CHROMIUM = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/opt/pw-browsers/chromium/chrome-linux/chrome",
  "/opt/ms-playwright/chromium-1194/chrome-linux/chrome",
  "/opt/ms-playwright/chromium/chrome-linux/chrome",
].find((candidate): candidate is string => typeof candidate === "string" && existsSync(candidate));

const PORT = 4181;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // WYŁĄCZNIE testy artefaktu. Reszta suity e2e jest napisana pod dev-server
  // (`playwright.config.ts`) i nie ma powodu płacić za nią drugim buildem.
  //
  // DWA PLIKI, JEDEN BUILD I JEDEN SERWER. Wzorzec obejmuje `boot-artifact`
  // (czy artefakt ŻYJE - interaktywność po hydratacji) i `boot-timing` (ILE TO
  // KOSZTUJE - TTFB, czas do gotowości, transfer ścieżki bootowania). Rozdział
  // na dwa pliki jest celowy: pierwszy jest bramką POPRAWNOŚCI i jego awaria
  // znaczy „strona jest martwa", drugi jest bramką BUDŻETU i jego awaria znaczy
  // „strona żyje, ale wolniej niż wolno". Zlanie ich w jeden plik zamieniłoby
  // te dwa komunikaty w jeden nieczytelny. Wspólna konfiguracja, bo najdroższy
  // składnik - build artefaktu (>=3 min 30 s w CI) i start serwera - jest
  // dokładnie ten sam, a `fullyParallel: false` daje im ustaloną kolejność.
  //
  // KOLEJNOŚĆ (alfabetyczna: artifact, potem timing) ma skutek dla POMIARU:
  // `boot-timing` jedzie po CIEPŁYM serwerze. Jest to świadome - liczba
  // z ciepłego procesu jest powtarzalna, a zimna zawiera jednorazowy koszt
  // rozgrzewki JIT-u i cache'u modułów, którego produkcyjny czytelnik na
  // Cloudflare i tak nie płaci przy każdym wejściu. Zmierzona różnica
  // zimny -> ciepły jest wpisana w progach `e2e/boot-timing.spec.ts`.
  testMatch: /boot-(artifact|timing)\.spec\.ts$/,
  // Hojniej niż 30 s z konfiguracji dev: pierwszy render zimnego artefaktu
  // z zaślepkami Supabase idzie przez pełne budżety loaderów.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  // BEZ PONOWIEŃ, także w CI. Ponowienie martwej hydratacji to zamiana
  // deterministycznej awarii na migotanie - a to jest dokładnie ta bramka,
  // której nie wolno dać się przemilczeć.
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    ...(LOCAL_CHROMIUM ? { launchOptions: { executablePath: LOCAL_CHROMIUM } } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Zbudowany serwer Node, nie dev-server. `.output/package.json` deklaruje
    // `{"main":"./server/index.mjs"}`.
    command: "node .output/server/index.mjs",
    url: BASE_URL,
    env: {
      PORT: String(PORT),
      HOST: "127.0.0.1",
      NITRO_PORT: String(PORT),
      NITRO_HOST: "127.0.0.1",
    },
    // NIGDY nie przejmuj cudzego serwera: przy `reuseExistingServer` test
    // mógłby zmierzyć dev-server z poprzedniego przebiegu i przejść na zielono,
    // nie dotykając artefaktu.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
