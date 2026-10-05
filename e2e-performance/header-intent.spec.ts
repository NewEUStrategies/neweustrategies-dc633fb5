// Nagłówek w oknie startu (P2.3) w prawdziwej przeglądarce, na artefakcie
// `build:smoke` (playwright.performance.config.ts, backend fixture).
//
// CO JEST PRZYPINANE.
//  1. Telefon (412 px): pełny nagłówek z buildera (`display: none` poniżej
//     `lg`) zostaje odwodnioną wyspą `hdr-desktop` do końca obserwacji, a
//     widoczna nawigacja telefonu (pasek mobilny) działa od razu.
//  2. Obrót/rozszerzenie okna do 1350 px: wyspa uwadnia się na TYM SAMYM HTML
//     serwera (te same węzły), bez przesunięcia układu w nagłówku.
//  3. Dotyk na desktopie (tablet w poziomie): pierwsze dotknięcie pola otwiera
//     wyszukiwarkę (fokus, wpisywanie), pierwsze dotknięcie konta - menu konta.
//  4. Gość na desktopie bez interakcji: wyspy wyszukiwarki i konta czekają.
//  5. Zapisana sesja: awatar w nagłówku najpóźniej 1 s po starcie aplikacji.
//
// ZALEŻNOŚĆ OD P2.2 (I2). Przypadki 1 i 4 wymagają stałej wartości kontekstu
// `AuthProvider` przy starcie gościa: dziś przejście `loading: false` w
// pierwszym przebiegu efektów dociera do każdej czekającej wyspy i otwiera ją
// przez kolejkę zaraz po starcie (GÓRNA GRANICA w `hydrationIsland.tsx`).
// Stałą wartość wprowadza P2.2 razem z wyspami sekcji, więc do jej scalenia
// oba przypadki są oznaczone `test.fail` - Playwright zgłosi je jako
// niespodziewanie zielone, gdy I2 wejdzie, i wtedy oznaczenie trzeba zdjąć.
//
// MASKA AKTYWACJI UŻYTKOWNIKA. Jak w `third-party-quiescence.spec.ts`:
// ewaluacje CDP Playwrighta nadają dokumentowi lepką aktywację, którą
// `firstInteraction.ts` czyta jako interakcję sprzed subskrypcji. Maska
// zwraca `true` dopiero po pierwszym zaufanym zdarzeniu aktywującym.
//
// Uruchamianie (wyłącznie pod mutexem maszyny, na zbudowanym worktree):
//   PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
//     bunx playwright test --config playwright.performance.config.ts \
//     e2e-performance/header-intent.spec.ts
import { expect, test, type Page } from "@playwright/test";
import {
  fixtureImageFor,
  fixtureResponse,
  isAnalyticsScript,
  isFixtureBackend,
} from "../scripts/performance/homeFixture";
import {
  authStorageKey,
  dockFixtureResponse,
  dockSession,
  isDockBackend,
} from "../scripts/performance/dockFixture";

const SUPABASE_URL = "http://127.0.0.1:4199";
const MOBILE = { width: 412, height: 823 };
const DESKTOP = { width: 1350, height: 940 };
/** Obserwacja „do końca śladu": dłużej niż okno Lighthouse po starcie, krócej niż zapas ciszy. */
const OBSERVE_MS = 4_000;
const DESKTOP_ISLAND = '[data-island-id="hdr-desktop"]';
const SEARCH_ISLAND = '[data-island-id^="hdr-search"]';
const ACCOUNT_ISLAND = '[data-island-id^="hdr-account"]';

declare global {
  interface Window {
    __nesAppReady?: boolean;
    __nesAppReadyAt?: number;
    __p23Shifts?: Array<{ value: number; startTime: number; inDesktopHeader: boolean }>;
  }
}

/** Maska aktywacji i obserwator przesunięć z atrybucją do nagłówka desktopowego. */
async function prepare(page: Page): Promise<void> {
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
    const shifts: NonNullable<Window["__p23Shifts"]> = [];
    window.__p23Shifts = shifts;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            value: number;
            sources?: Array<{ node?: Node | null }>;
          };
          const inDesktopHeader = (shift.sources ?? []).some(
            (source) =>
              source.node instanceof Element &&
              source.node.closest('[data-island-id="hdr-desktop"]') !== null,
          );
          shifts.push({ value: shift.value, startTime: shift.startTime, inDesktopHeader });
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Bez Layout Instability API zostaje kontrola tożsamości węzłów.
    }
  });
}

/** Backend gościa: fixture strony głównej; nieznane tabele/RPC = pusta odpowiedź. */
async function routeGuest(page: Page): Promise<void> {
  await page.route(
    (url) => url.hostname !== "127.0.0.1" || isFixtureBackend(url.href),
    async (route) => {
      const request = route.request();
      if (isAnalyticsScript(request.url())) return route.fulfill({ status: 204, body: "" });
      if (isFixtureBackend(request.url())) {
        const response = await fixtureResponse(
          new Request(request.url(), {
            method: request.method(),
            headers: request.headers(),
            body: request.method() === "POST" ? request.postData() : undefined,
          }),
        ).catch(() => Response.json([], { headers: { "access-control-allow-origin": "*" } }));
        return route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: await response.text(),
        });
      }
      if (request.resourceType() === "image") {
        const image = fixtureImageFor(request.url());
        return route.fulfill({ body: image.body, contentType: image.contentType });
      }
      return route.fulfill({ status: 204, body: "" });
    },
  );
}

/** Backend zalogowanego: sesja i tabele członka z fixture'u doku, reszta z fixture'u strony. */
async function routeMember(page: Page): Promise<void> {
  await page.route(
    (url) => url.hostname !== "127.0.0.1" || isDockBackend(url.href),
    async (route) => {
      const request = route.request();
      if (isDockBackend(request.url())) {
        const result = await dockFixtureResponse(
          new Request(request.url(), {
            method: request.method(),
            headers: request.headers(),
            body: request.method() === "POST" ? (request.postData() ?? undefined) : undefined,
          }),
          { delayMs: 0 },
        ).catch(() => ({ response: Response.json([]) }));
        return route.fulfill({
          status: result.response.status,
          headers: Object.fromEntries(result.response.headers),
          body: await result.response.text(),
        });
      }
      if (request.resourceType() === "image") {
        const image = fixtureImageFor(request.url());
        return route.fulfill({ body: image.body, contentType: image.contentType });
      }
      return route.fulfill({ status: 204, body: "" });
    },
  );
}

async function open(page: Page): Promise<void> {
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await page.waitForFunction(() => window.__nesAppReady === true);
}

async function islandState(page: Page, selector: string): Promise<string | null> {
  return page.locator(selector).first().getAttribute("data-island-state");
}

async function waitForHydrated(page: Page, selector: string): Promise<void> {
  await expect.poll(() => islandState(page, selector), { timeout: 10_000 }).toBe("hydrated");
}

test.describe("nagłówek w oknie startu (P2.3)", () => {
  test("412 px: nagłówek desktopowy odwodniony do końca obserwacji, pasek mobilny działa", async ({
    page,
  }) => {
    test.fail(true, "wymaga stałego kontekstu AuthProvider przy starcie gościa (I2, P2.2)");
    await page.setViewportSize(MOBILE);
    await prepare(page);
    await routeGuest(page);
    await open(page);
    await expect(page.locator(DESKTOP_ISLAND)).toBeHidden();
    await page.waitForTimeout(OBSERVE_MS);
    expect(await islandState(page, DESKTOP_ISLAND)).toBe("pending");
    // Widoczna nawigacja telefonu: szuflada i wyszukiwarka od pierwszego dotknięcia.
    await page.locator('button[aria-controls="mobile-header-drawer"]').click();
    await expect(page.locator("#mobile-header-drawer")).toBeVisible();
    expect(await islandState(page, DESKTOP_ISLAND)).toBe("pending");
  });

  test("412 -> 1350 px: nagłówek desktopowy uwadnia się na tym samym HTML, bez przesunięć", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await prepare(page);
    await routeGuest(page);
    await open(page);
    // Znacznik na węźle serwera: render klienta wyspy podmieniłby węzeł.
    const marked = await page.evaluate((selector) => {
      const section = document.querySelector(`${selector} [data-sec-id]`);
      if (!section) return false;
      Reflect.set(section, "__p23Server", true);
      return true;
    }, DESKTOP_ISLAND);
    expect(marked).toBe(true);
    const resizedAt = await page.evaluate(() => performance.now());
    await page.setViewportSize(DESKTOP);
    await expect(page.locator(DESKTOP_ISLAND)).toBeVisible();
    await waitForHydrated(page, DESKTOP_ISLAND);
    await page.waitForTimeout(500);
    const result = await page.evaluate(
      ({ selector, since }) => {
        const section = document.querySelector(`${selector} [data-sec-id]`);
        const shifts = (window.__p23Shifts ?? []).filter(
          (shift) => shift.startTime > since && shift.inDesktopHeader,
        );
        return {
          sameNode: section !== null && Reflect.get(section, "__p23Server") === true,
          headerShift: shifts.reduce((sum, shift) => sum + shift.value, 0),
        };
      },
      { selector: DESKTOP_ISLAND, since: resizedAt },
    );
    expect(result).toEqual({ sameNode: true, headerShift: 0 });
  });

  test("dotyk na desktopie: pierwsze dotknięcie otwiera wyszukiwarkę i menu konta", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: DESKTOP,
      hasTouch: true,
      locale: "pl-PL",
    });
    const page = await context.newPage();
    try {
      await prepare(page);
      await routeGuest(page);
      await open(page);
      const input = page.locator(`${SEARCH_ISLAND} input[type="search"]`).first();
      await input.tap();
      await waitForHydrated(page, SEARCH_ISLAND);
      await expect(input).toBeFocused();
      await page.keyboard.type("eu");
      await expect(input).toHaveValue("eu");

      await page.locator(`${ACCOUNT_ISLAND} button`).first().tap();
      await expect(page.locator("[data-account-menu]")).toBeVisible({ timeout: 10_000 });
    } finally {
      await context.close();
    }
  });

  test("gość na desktopie bez interakcji: wyszukiwarka i konto czekają", async ({ page }) => {
    test.fail(true, "wymaga stałego kontekstu AuthProvider przy starcie gościa (I2, P2.2)");
    await page.setViewportSize(DESKTOP);
    await prepare(page);
    await routeGuest(page);
    await open(page);
    expect(await islandState(page, DESKTOP_ISLAND)).toBe("hydrated");
    await page.waitForTimeout(OBSERVE_MS);
    expect(await islandState(page, SEARCH_ISLAND)).toBe("pending");
    expect(await islandState(page, ACCOUNT_ISLAND)).toBe("pending");
    await expect(page.locator("[data-account-menu]")).toHaveCount(0);
  });

  test("zapisana sesja: awatar w nagłówku najpóźniej 1 s po starcie aplikacji", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await prepare(page);
    await page.addInitScript(
      ([key, value]) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          /* bez magazynu test zobaczy brak awatara */
        }
      },
      [authStorageKey(SUPABASE_URL), JSON.stringify(dockSession())] as const,
    );
    await routeMember(page);
    await open(page);
    const handle = await page.waitForFunction(
      (selector) =>
        document.querySelector(`${selector} button[title]`) !== null ? performance.now() : false,
      ACCOUNT_ISLAND,
      { polling: "raf", timeout: 10_000 },
    );
    const avatarAt = Number(await handle.jsonValue());
    const readyAt = await page.evaluate(() => window.__nesAppReadyAt ?? 0);
    expect(readyAt).toBeGreaterThan(0);
    expect(avatarAt - readyAt).toBeLessThanOrEqual(1_000);
    expect(await islandState(page, ACCOUNT_ISLAND)).toBe("hydrated");
  });
});
