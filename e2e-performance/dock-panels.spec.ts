import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  authStorageKey,
  DOCK_MARKERS,
  DOCK_REQUIRED_TABLES,
  DOCK_ROUND_TRIP_MS,
  dockFixtureResponse,
  dockSession,
  isDockBackend,
  savedBookmarkMarker,
} from "../scripts/performance/dockFixture";

// CZAS OD KLIKNIĘCIA ZAKŁADKI DO TREŚCI PANELU - pomiar, którego nie robił
// dotąd żaden test w tym repozytorium.
//
// ── DLACZEGO TEGO NIE BYŁO ──────────────────────────────────────────────
// Pasek przestrzeni roboczej nie renderuje się dla gościa (bramka
// w `SiteChrome`), a wszystkie dotychczasowe pomiary wydajności są anonimowe.
// Testy jednostkowe dowodzą, że rozgrzewanie jest WOŁANE (atrapa zapisuje
// wywołania), ale nie mogą pokazać, ile ono OSZCZĘDZA - do tego potrzebna
// jest prawdziwa przeglądarka, prawdziwy podział na chunki i opóźniona baza.
//
// ── CO JEST MIERZONE ────────────────────────────────────────────────────
// Dla każdego panelu dwa przebiegi na osobnej stronie:
//   ZIMNY     - klik bez uprzedzenia. Paczka panelu i jego zapytanie startują
//               PO kliknięciu, szeregowo.
//   ROZGRZANY - najechanie kursorem, przerwa, potem klik. `prefetchDockPanel`
//               i `prefetchDockData` odpaliły się na `pointerenter`, więc
//               w chwili kliknięcia kod i dane są w drodze albo już są.
// Miarą jest odstęp od `click` do pojawienia się WŁASNEJ treści panelu -
// napisu, który istnieje TYLKO w tym zestawie danych. Liczba wierszy do tego
// nie wystarcza: panele renderują szkielet ładowania jako `<ul><li>`, więc
// „policz `li`" przechodziłoby na szkielecie i pomiar byłby fałszem.
//
// ── CO TO JEST, A CZYM NIE JEST ─────────────────────────────────────────
// To pomiar LABORATORYJNY na stałym opóźnieniu bazy (120 ms na podróż) i na
// tym samym artefakcie produkcyjnym przed i po. Nie jest prognozą sieci
// czytelnika ani p75 z produkcji. Budżet jest jednostronny i luźny - ma
// wyłapać REGRESJĘ RZĘDU WIELKOŚCI (np. powrót statycznego importu okna
// rozmowy albo zniknięcie rozgrzewania), a nie pilnować milisekund na hoście
// CI, którego wariancji nie kontroluję.

declare global {
  interface Window {
    __dockOpen?: { startedAt: number };
  }
}

const SUPABASE_URL = "http://127.0.0.1:4199";

/**
 * NIEZGODNOŚĆ HYDRATACJI ODZIEDZICZONA - nie z tej zmiany.
 *
 * Ten spec ZNALAZŁ na trasie `/` pod zalogowanym użytkownikiem błąd React #418
 * („server rendered HTML didn't match the client"). Sprawdzone, a nie
 * założone: ten sam pomiar puszczony na artefakcie `origin/main` (0be19f5,
 * BEZ żadnej części pracy nad dokiem) daje wynik BAJT W BAJT taki sam -
 * #418 dla zalogowanego na `/`, cisza dla gościa na `/`, dla zalogowanego na
 * `/login` i dla gościa na `/cookies`. Dok nie może być źródłem: `useAuth`
 * startuje z `session: null`, więc PIERWSZY render klienta - ten hydratujący -
 * nie ma jeszcze użytkownika i dok jest w nim nieobecny dokładnie tak, jak
 * w HTML-u z serwera.
 *
 * Dlatego jest tu WYJĄTEK IMIENNY, a nie wyłączona asercja: każdy inny błąd
 * strony oblewa przebieg, więc niezgodność WNIESIONA przez dok zostałaby
 * złapana. Wyjątek jest zapisany jako dług do rozliczenia osobno - milczące
 * `try/catch` zamieniłoby znalezisko w nic.
 */
const INHERITED_PAGE_ERRORS = [/Minified React error #418/] as const;

/** Panele narzędzi: identyfikator zakładki i napis dowodzący własnej treści. */
const PANELS = [
  { tool: "todos", marker: DOCK_MARKERS.todos },
  { tool: "notes", marker: DOCK_MARKERS.notes },
  { tool: "saved", marker: DOCK_MARKERS.saved },
] as const;

/**
 * Budżet górny na otwarcie ZIMNE. Trzy podróże do bazy (120 ms) plus pobranie
 * i wykonanie paczki panelu plus render - z hojnym marginesem na wariancję
 * runnera. Ma padać na regresji rzędu wielkości, nie na szumie.
 * Zmierzone na hoście deweloperskim: todos 685 ms, notes 958 ms.
 */
const COLD_BUDGET_MS = 6000;

interface Sink {
  unknown: string[];
  errors: string[];
}

function watch(page: Page, sink: Sink): void {
  page.on("pageerror", (error) => {
    if (INHERITED_PAGE_ERRORS.some((pattern) => pattern.test(error.message))) return;
    sink.errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (INHERITED_PAGE_ERRORS.some((pattern) => pattern.test(text))) return;
    // Brak sieci do świata i realtime zablokowany przez CSP to własność
    // STANOWISKA (zaślepiona baza, brak websocketu), nie produktu.
    if (/ERR_TUNNEL_CONNECTION_FAILED|realtime|Content Security Policy/.test(text)) return;
    if (/hydration|Minified React error/.test(text)) sink.errors.push(text);
  });
}

async function seedSession(page: Page): Promise<void> {
  const key = authStorageKey(SUPABASE_URL);
  const session = dockSession();
  await page.addInitScript(
    ([storageKey, value]) => {
      try {
        window.localStorage.setItem(storageKey as string, JSON.stringify(value));
      } catch {
        /* brak magazynu - test zauważy brakiem paska */
      }
    },
    [key, session] as const,
  );
}

async function routeBackend(page: Page, sink: Sink): Promise<void> {
  await page.route(
    (url) => isDockBackend(url.href),
    async (route) => {
      const request = route.request();
      const result = await dockFixtureResponse(
        new Request(request.url(), {
          method: request.method(),
          headers: request.headers(),
          body: request.method() === "POST" ? (request.postData() ?? undefined) : undefined,
        }),
      ).catch((error: unknown) => {
        sink.errors.push(String(error));
        return { response: Response.json({ message: String(error) }, { status: 501 }) };
      });
      if (result.unknown) sink.unknown.push(result.unknown);
      return route.fulfill({
        status: result.response.status,
        headers: Object.fromEntries(result.response.headers),
        body: await result.response.text(),
      });
    },
  );
}

/**
 * Zakładka WIDOCZNA. Pasek montuje OBA rzędy - mobilny i desktopowy - a jeden
 * z nich ukrywa klasą (`sm:hidden` / `hidden sm:flex`), bo punkt przełamania
 * zna wyłącznie CSS (patrz komentarz przy `<nav>` w `WorkspaceDock`). Skutek
 * dla pomiaru: `saved` istnieje w DWÓCH rzędach, więc goły selektor trafia
 * w pierwszy - ten schowany - i klik nigdy nie dochodzi. Filtr widoczności
 * wybiera ten rząd, który przy danej szerokości naprawdę obsługuje kursor.
 */
function tab(page: Page, id: string) {
  return page.locator(`[data-dock-tab="${id}"]:visible`).first();
}

/** Pasek pojawia się dopiero po rozstrzygnięciu sesji i pobraniu powłoki. */
async function waitForDock(page: Page): Promise<void> {
  await page.waitForSelector("[data-workspace-dock]", { timeout: 20_000 });
  await expect(tab(page, "todos")).toBeVisible({ timeout: 20_000 });
}

/**
 * Czas od kliknięcia do własnej treści panelu. Znacznik startu bierzemy
 * W PRZEGLĄDARCE (`performance.now()` przed kliknięciem), żeby nie mierzyć
 * narzutu sterownika Playwrighta.
 */
async function measureOpen(page: Page, tool: string, marker: string): Promise<number> {
  await page.evaluate(() => {
    window.__dockOpen = { startedAt: performance.now() };
  });
  await tab(page, tool).click();
  const panel = page.locator("#workspace-dock-panel");
  await expect(panel.getByText(marker, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  const elapsed = await page.evaluate(
    () => performance.now() - (window.__dockOpen?.startedAt ?? 0),
  );
  // Treść jest, więc ŻADEN szkielet nie może już stać w panelu - inaczej
  // zmierzylibyśmy stan przejściowy i nazwali go gotowym.
  await expect(panel.locator('[aria-busy="true"]')).toHaveCount(0);
  return elapsed;
}

test.describe("otwieranie paneli doku", () => {
  // ── PRZEBIEG BAZOWY POMIJAMY, I TO NIE JEST WYGODNICTWO ───────────────
  // Zadanie `first-visit` mierzy DWA artefakty: bazowy (commit sprzed zmiany)
  // i kandydata, żeby budżety malowania miały punkt odniesienia - stąd wzorzec
  // „mierz oba, bramkuj kandydata" w `first-visit.spec.ts`. Ten spec do tego
  // porównania NIC nie wnosi: jest bramką jednostronną i nie zestawia się
  // z niczym. Co więcej, na commicie bazowym TEJ zmiany mierzonej powierzchni
  // NIE MA WCALE - `data-dock-tab`, `#workspace-dock-panel` i `.wd-drawer`
  // pojawiają się dopiero tutaj - więc przebieg bazowy nie zmierzyłby regresji,
  // tylko czekał do wyczerpania limitu na zakładkę, której nie ma.
  test.skip(
    process.env.NES_PERFORMANCE_BASELINE === "1",
    "przebieg bazowy nie ma paska przestrzeni roboczej do zmierzenia",
  );

  for (const panel of PANELS) {
    test(`panel ${panel.tool}: zimno i po rozgrzaniu`, async ({ page }, testInfo) => {
      const sink: Sink = { unknown: [], errors: [] };
      await routeBackend(page, sink);
      await seedSession(page);
      watch(page, sink);

      // ── PRZEBIEG ZIMNY ──────────────────────────────────────────────
      await page.goto("/");
      await waitForDock(page);
      const cold = await measureOpen(page, panel.tool, panel.marker);

      // ── PRZEBIEG ROZGRZANY ──────────────────────────────────────────
      // Świeża strona, więc paczka i cache zapytań startują od zera - inaczej
      // drugi pomiar mierzyłby cache pierwszego, a nie rozgrzewanie.
      await page.goto("about:blank");
      await page.goto("/");
      await waitForDock(page);
      await tab(page, panel.tool).hover();
      // Tyle, ile trwa jedna podróż do bazy plus zapas na pobranie paczki -
      // czyli dokładnie okno, które daje użytkownik przenoszący kursor.
      await page.waitForTimeout(DOCK_ROUND_TRIP_MS * 3);
      const warm = await measureOpen(page, panel.tool, panel.marker);

      mkdirSync("reports", { recursive: true });
      writeFileSync(
        `reports/dock-open-${panel.tool}.json`,
        `${JSON.stringify(
          {
            tool: panel.tool,
            coldMs: Math.round(cold),
            warmMs: Math.round(warm),
            roundTripMs: DOCK_ROUND_TRIP_MS,
          },
          null,
          2,
        )}\n`,
      );
      await testInfo.attach(`dock-open-${panel.tool}`, {
        body: `zimno ${Math.round(cold)} ms, rozgrzane ${Math.round(warm)} ms`,
        contentType: "text/plain",
      });

      // Fixture musi znać każdą tabelę, po którą sięga dok - inaczej „panel
      // pusty" znaczyłoby „fixture niepełny", a nie „tak działa produkt".
      const missing = sink.unknown.filter((name) =>
        (DOCK_REQUIRED_TABLES as readonly string[]).includes(name),
      );
      expect(sink.errors, sink.errors.join("\n")).toEqual([]);
      expect(missing, `fixture nie zna tabel doku: ${[...new Set(missing)].join(", ")}`).toEqual(
        [],
      );

      // Budżet jednostronny: łapie regresję rzędu wielkości.
      expect(cold, `zimne otwarcie ${panel.tool}`).toBeLessThan(COLD_BUDGET_MS);
      // ROZGRZANIE NIE MOŻE SZKODZIĆ. Świadomie NIE wymagam tu „warm < cold":
      // zmierzone na hoście deweloperskim notes 958 -> 531 ms, ale todos
      // 685 -> 806 ms, czyli przy jednej próbce różnica tonie w wariancji,
      // a test-wyścig jest gorszy niż brak testu. Regresję rozgrzewania łapią
      // asercje jednostkowe (`WorkspaceDock.test.tsx`: `pointerenter` woła oba
      // rozgrzewania), a ten budżet pilnuje, że droga krytyczna nie urosła.
      expect(warm, `rozgrzane otwarcie ${panel.tool}`).toBeLessThan(COLD_BUDGET_MS);
    });
  }

  test("panel Zapisane dojeżdża DRUGĄ turą do tytułów materiałów", async ({ page }) => {
    // Najdłuższa droga w całym doku: `user_bookmarks` daje identyfikatory,
    // dopiero druga tura pobiera tytuły z `posts`. Wiersz kolejki czytania
    // (marker `saved`) pokazuje się BEZ tej tury, więc sam nie dowodzi, że
    // zakładki działają - dlatego jest tu osobna asercja na tytuł wpisu.
    const sink: Sink = { unknown: [], errors: [] };
    await routeBackend(page, sink);
    await seedSession(page);
    watch(page, sink);

    await page.goto("/");
    await waitForDock(page);
    await tab(page, "saved").click();
    const panel = page.locator("#workspace-dock-panel");
    await expect(panel.getByText(savedBookmarkMarker(), { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
    expect(sink.errors, sink.errors.join("\n")).toEqual([]);
  });

  test("skrzynka czatu otwiera LISTĘ bez pobierania okna rozmowy", async ({ page }) => {
    // TO JEST POMIAR NAPRAWY, KTÓRA DAŁA NAJWIĘKSZĄ RÓŻNICĘ. `ChatSideDrawer`
    // importował okno rozmowy i dialog grupy STATYCZNIE, więc otwarcie samej
    // listy wątków ciągnęło ich kod razem ze skrzynką.
    //
    // ── DLACZEGO PRZEZ PIGUŁKĘ „+N", A NIE PRZEZ ZAKŁADKĘ ────────────────
    // Zakładka „Czat" to SKRÓT paska: powstaje wyłącznie dla pozycji
    // o identyfikatorze `chats` w ustawieniu `mobile_bottom_bar`, a to
    // ustawienie przyjeżdża z serwera w stanie odwodnionym, więc podmiana po
    // stronie przeglądarki nic nie zmienia. Druga droga jest LEPSZA dla tego
    // pomiaru: przycisk „+N" nad paskiem woła `onOpenInbox` BEZ przywracania
    // rozmowy, czyli otwiera skrzynkę z samą listą i bez zaznaczenia - dokładnie
    // stan, w którym okno rozmowy nie ma prawa się pobrać.
    const sink: Sink = { unknown: [], errors: [] };
    await routeBackend(page, sink);
    await seedSession(page);
    watch(page, sink);

    // Trzy zminimalizowane rozmowy: limit widocznych pigułek to 2, więc trzecia
    // tworzy przycisk „+1". Magazyn jest w `sessionStorage` i czyta się
    // synchronicznie, więc zasianie przed skryptami strony wystarcza.
    await page.addInitScript(() => {
      try {
        window.sessionStorage.setItem(
          "nes.chat.minimized",
          JSON.stringify([
            { id: "conv-pomiar-1", name: "Rozmowa pomiarowa 1" },
            { id: "conv-pomiar-2", name: "Rozmowa pomiarowa 2" },
            { id: "conv-pomiar-3", name: "Rozmowa pomiarowa 3" },
          ]),
        );
      } catch {
        /* brak magazynu - test zauważy brakiem pigułki */
      }
    });

    const chunks: string[] = [];
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (path.startsWith("/assets/") && path.endsWith(".js")) chunks.push(path);
    });

    await page.goto("/");
    await waitForDock(page);
    await page.waitForTimeout(DOCK_ROUND_TRIP_MS * 2);

    // ── ASERCJA PIERWSZA: DOMKNIĘCIE POCZĄTKOWE JEST CZYSTE ─────────────
    // Ani skrzynka, ani okno rozmowy, ani dialog grupy nie mogą przyjechać
    // z samym wejściem na stronę. To ta asercja oblałaby powrót importu
    // statycznego do paska.
    const chatty = (path: string) => /ChatSideDrawer|ChatWindow|GroupCreateDialog/.test(path);
    expect(
      chunks.filter(chatty),
      `czat w domknięciu początkowym: ${chunks.filter(chatty).join(", ")}`,
    ).toEqual([]);

    chunks.length = 0;
    const more = page.locator(".wd-pill:visible").last();
    await expect(more).toBeVisible({ timeout: 15_000 });
    await more.click();
    // Opakowanie skrzynki NIE MA własnych wymiarów - jej dziecko jest
    // `position: fixed`, więc `#workspace-dock-chat` jest z punktu widzenia
    // przeglądarki niewidoczne i domyślny `state: "visible"` nigdy nie
    // dochodzi. Czekamy więc na PRZYCZEPIENIE opakowania i osobno na
    // widoczność właściwej skrzynki (`.wd-drawer`, po dojechaniu paczki).
    await page.waitForSelector("#workspace-dock-chat", {
      state: "attached",
      timeout: 15_000,
    });
    await expect(page.locator("#workspace-dock-chat .wd-drawer")).toBeVisible({
      timeout: 15_000,
    });
    // Dwa razy tyle, ile trwa podróż do bazy, plus zapas: gdyby okno rozmowy
    // było w paczce skrzynki, przyjechałoby RAZEM z nią, czyli w tym okienku.
    await page.waitForTimeout(DOCK_ROUND_TRIP_MS * 6);

    // ── ASERCJA DRUGA: SKRZYNKA PRZYJECHAŁA, OKNO ROZMOWY NIE ───────────
    // Nazwa chunku pochodzi od modułu, więc dopasowanie jest stabilne wobec
    // skrótu zawartości.
    const drawer = chunks.filter((path) => /ChatSideDrawer/.test(path));
    const window_ = chunks.filter((path) => /ChatWindow|GroupCreateDialog/.test(path));
    expect(drawer.length, "paczka skrzynki nie przyjechała po kliknięciu").toBeGreaterThan(0);
    expect(
      window_,
      `okno rozmowy pobrane przy samym otwarciu listy: ${window_.join(", ")}`,
    ).toEqual([]);
    expect(sink.errors, sink.errors.join("\n")).toEqual([]);
  });
});
