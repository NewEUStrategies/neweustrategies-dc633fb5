import { expect, test, type Page } from "@playwright/test";
import { fixtureResponse, isFixtureBackend } from "../scripts/performance/homeFixture";

// ZERO ŻĄDAŃ SUPABASE Z BOOTU ANONIMOWEJ `/` (P3.8), na artefakcie i fixture
// `first-visit` (ten sam serwer co `boot-home`, `playwright.artifact.config.ts`).
//
// Do P3.8 boot strony głównej wysyłał z przeglądarki 7 GET-ów PostgREST (każdy
// z preflightem): `site_design_tokens` (tabela rozmiarów czcionek spoza stanu
// SSR), `post_layout_settings` (zasiew `updatedAt: 0` odświeżany w hydratacji),
// `ad_placements` (pasek dolny), `newsletter_settings` i `builder_popups`
// (nakładki po `load`), `categories` i `tags` (katalog formularza w wyspie).
// Teraz wszystko, czego boot nie potrzebuje, czeka na zatrzask „pierwsza
// interakcja ALBO punkt ciszy" (`lib/performance/interactionOrQuiet.ts`).
//
// CO JEST PRZYPINANE:
//  1. Od nawigacji do 3 s po `load` (punkt ciszy zapada najwcześniej 5 s po
//     `load`) przeglądarka nie wysyła ANI JEDNEGO żądania do `/rest/v1/`.
//  2. Kontrola pozytywna: pierwsza interakcja (kółko myszy) otwiera zatrzask
//     i odroczone odczyty ruszają - „później", nie „nigdy" (układ treści
//     z `ContentAreaStyle`, ustawienia popupu newslettera).
//
// MASKA AKTYWACJI UŻYTKOWNIKA (jak `motion-gate.boot-home.spec.ts`): ewaluacje
// CDP nadają dokumentowi lepką aktywację, którą `firstInteraction` czyta jako
// interakcję sprzed subskrypcji - zatrzask otwierałby się sam.

declare global {
  interface Window {
    __nesAppReady?: boolean;
  }
}

/** Czas od `load`, do którego boot ma milczeć wobec bazy (cisza: ≥ 5 s po `load`). */
const QUIET_WINDOW_AFTER_LOAD_MS = 3_000;

// Ten sam wybór wariantu co `playwright.artifact.config.ts`. Przypinany jest boot
// z KOMPLETNYM stanem SSR: przy zaślepkach Supabase (wariant bez fixture) SSR
// degraduje, a zasiewy `updatedAt: 0` leczą się od razu po hydratacji - celowo
// (`e2e/ssr-degradation.spec.ts`), więc „zero żądań" nie jest tam kontraktem.
const ARTIFACT_FIXTURE =
  process.env.NES_ARTIFACT_FIXTURE === "1" ||
  (process.env.NES_ARTIFACT_FIXTURE !== "0" &&
    !process.env.SUPABASE_URL &&
    !process.env.VITE_SUPABASE_URL);

interface BackendRequest {
  readonly method: string;
  readonly table: string;
}

async function prepare(page: Page): Promise<BackendRequest[]> {
  await page.addInitScript(() => {
    let activated = false;
    for (const type of ["keydown", "mousedown", "pointerdown", "pointerup", "touchend"]) {
      window.addEventListener(
        type,
        (event) => {
          if (event.isTrusted) activated = true;
        },
        { capture: true, passive: true },
      );
    }
    Object.defineProperty(Navigator.prototype, "userActivation", {
      configurable: true,
      get: () => ({ hasBeenActive: activated, isActive: activated }),
    });
  });
  await page.setExtraHTTPHeaders({ "accept-language": "pl" });
  const requests: BackendRequest[] = [];
  await page.route(
    (url) => isFixtureBackend(url.href),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== "OPTIONS") {
        requests.push({
          method: request.method(),
          table: url.pathname.replace(/^\/rest\/v1\//, ""),
        });
      }
      const response = await fixtureResponse(
        new Request(url, {
          method: request.method(),
          headers: request.headers(),
          body: request.method() === "POST" ? request.postData() : undefined,
        }),
      );
      return route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    },
  );
  return requests;
}

test("boot anonimowej `/` nie wysyła żądań Supabase; interakcja otwiera odroczone odczyty", async ({
  page,
}) => {
  test.skip(!ARTIFACT_FIXTURE, "wymaga artefaktu z danymi fixture (kompletny stan SSR)");
  // Rozgrzanie serwera: dokument z zimnego izolatu może przekroczyć termin fali 1
  // strony głównej i zejść na zasiewy (a te leczą się od razu - nie o tym jest ten
  // test). Taki dokument jest `no-store`, więc pomiar dostaje świeży, kompletny render.
  await page.request.get("/", { headers: { "accept-language": "pl" } });
  const requests = await prepare(page);
  await page.goto("/", { waitUntil: "load" });
  await expect.poll(() => page.evaluate(() => window.__nesAppReady === true)).toBe(true);
  await page.waitForTimeout(QUIET_WINDOW_AFTER_LOAD_MS);

  expect(
    requests.map((request) => `${request.method} ${request.table}`),
    "żądania PostgREST w oknie bootu (przed interakcją i przed punktem ciszy)",
  ).toEqual([]);

  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, 400);

  await expect
    .poll(() => requests.map((request) => request.table).sort(), {
      message: "odroczone odczyty po pierwszej interakcji",
    })
    .toEqual(expect.arrayContaining(["newsletter_settings", "post_layout_settings"]));
});
