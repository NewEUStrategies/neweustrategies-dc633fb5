// Nagłówek w oknie startu (P2.3) w prawdziwej przeglądarce, na artefakcie
// `build:smoke` (playwright.performance.config.ts, backend fixture).
//
// CO JEST PRZYPINANE.
//  1. Telefon (412 px): pełny nagłówek z buildera (`display: none` poniżej
//     `lg`) jest ukryty, a widoczna nawigacja telefonu (pasek mobilny, jego
//     szuflada) działa od pierwszego dotknięcia.
//  2. Telefon (412 px): wyspa `hdr-desktop` zostaje odwodniona do końca
//     obserwacji (I2, niżej).
//  3. Obrót/rozszerzenie okna do 1350 px: wyspa uwadnia się na TYM SAMYM HTML
//     serwera (te same węzły), bez przesunięcia układu w nagłówku.
//  4. Dotyk na desktopie (tablet w poziomie): nagłówek desktopowy żyje od
//     startu, pierwsze dotknięcie pola otwiera wyszukiwarkę (fokus,
//     wpisywanie), pierwsze dotknięcie konta - menu konta.
//  5. Gość na desktopie bez interakcji: wyspy wyszukiwarki i konta czekają
//     (I2, niżej).
//  6. Zapisana sesja: awatar w nagłówku najpóźniej 1 s po starcie aplikacji.
//  7. Pasek „Na czasie" (F10): ruch ozdobny (płomień, puls `live`, gradient
//     `ribbon`) rusza dopiero po pierwszej interakcji, a przy
//     `prefers-reduced-motion: reduce` nie rusza wcale - sprawdzane na
//     wyliczonym `animation-name`, czyli na kaskadzie arkusza paska w
//     przeglądarce, nie na jego tekście.
//
// ZALEŻNOŚĆ OD P2.2 (I2). Przypadki 2 i 5 wymagają stałej wartości kontekstu
// `AuthProvider` przy starcie gościa: dziś przejście `loading: false` w
// pierwszym przebiegu efektów dociera do każdej czekającej wyspy i otwiera ją
// przez kolejkę zaraz po starcie (GÓRNA GRANICA w `hydrationIsland.tsx`).
// Stałą wartość wprowadza P2.2 razem z wyspami sekcji, więc do jej scalenia
// oba przypadki są oznaczone `test.fail` - Playwright zgłosi je jako
// niespodziewanie zielone, gdy I2 wejdzie, i wtedy oznaczenie trzeba zdjąć.
// Warunki wstępne obu przypadków (pasek mobilny działa; na desktopie wyspa
// `hdr-desktop` uwadnia się od razu) przypinają ZIELONE przypadki 1 i 4, a w
// przypadkach `test.fail` jedynymi asercjami po obserwacji są stany
// `pending` - bez I2 padają dokładnie na nich (przebieg kontrolny bez
// `test.fail`: raport P2.3 IMPL-fix1).
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
const TICKER = '[data-testid="trending-ticker"]';
const I2 = "wymaga stałego kontekstu AuthProvider przy starcie gościa (I2, P2.2)";

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

interface TickerMotion {
  readonly attribute: boolean;
  readonly flame: string;
  readonly ribbon: string;
  readonly livePing: string;
}

/**
 * Wyliczony `animation-name` ruchu ozdobnego paska. Płomień to prawdziwy
 * element paska (fixture: układ `classic`, `flicker`); skórek `ribbon` i
 * `live` fixture nie ma, więc sonda z ich klasami pod kopią atrybutu
 * `data-tt-motion` korzenia sprawdza te same reguły arkusza paska (arkusz
 * działa w całym dokumencie). Sonda znika po odczycie.
 */
async function tickerMotion(page: Page): Promise<TickerMotion> {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const flame = root?.querySelector(".tt-flame");
    if (!root || !flame) throw new Error("brak paska „Na czasie” albo płomienia w fixture");
    const attribute = root.hasAttribute("data-tt-motion");
    const element = (tag: string, className: string, child?: Element): Element => {
      const node = document.createElement(tag);
      node.className = className;
      if (child) node.append(child);
      return node;
    };
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;left:-9999px;top:0;visibility:hidden";
    if (attribute) probe.setAttribute("data-tt-motion", "");
    const track = element("div", "tt-glass-track");
    const icon = element("span", "tt-chip-icon");
    probe.append(element("div", "tt-skin--ribbon", track), element("div", "tt-skin--live", icon));
    document.body.append(probe);
    try {
      return {
        attribute,
        flame: getComputedStyle(flame).animationName,
        ribbon: getComputedStyle(track).animationName,
        livePing: getComputedStyle(icon, "::before").animationName,
      };
    } finally {
      probe.remove();
    }
  }, TICKER);
}

/** Pierwsza interakcja (klawisz bez skutków ubocznych) i czekanie na ruch paska. */
async function interactAndWaitForMotion(page: Page): Promise<void> {
  await page.keyboard.press("Shift");
  await expect(page.locator(TICKER).first()).toHaveAttribute("data-tt-motion", "");
}

test.describe("nagłówek w oknie startu (P2.3)", () => {
  test("412 px: nagłówek desktopowy ukryty, pasek mobilny działa od pierwszego dotknięcia", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await prepare(page);
    await routeGuest(page);
    await open(page);
    await expect(page.locator(DESKTOP_ISLAND)).toBeHidden();
    // Widoczna nawigacja telefonu: szuflada od pierwszego dotknięcia.
    await page.locator('button[aria-controls="mobile-header-drawer"]').click();
    await expect(page.locator("#mobile-header-drawer")).toBeVisible();
    await expect(page.locator(DESKTOP_ISLAND)).toBeHidden();
  });

  test("412 px: nagłówek desktopowy odwodniony do końca obserwacji", async ({ page }) => {
    test.fail(true, I2);
    await page.setViewportSize(MOBILE);
    await prepare(page);
    await routeGuest(page);
    await open(page);
    await page.waitForTimeout(OBSERVE_MS);
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
      // Na desktopie nagłówek z buildera żyje od startu (media wyspy pasuje).
      await waitForHydrated(page, DESKTOP_ISLAND);
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
    test.fail(true, I2);
    await page.setViewportSize(DESKTOP);
    await prepare(page);
    await routeGuest(page);
    await open(page);
    // Granica wyspy hydratuje w odroczonym przebiegu Offscreen, więc na „app
    // ready" bywa jeszcze `pending` - czekamy, zamiast sprawdzać od razu.
    await waitForHydrated(page, DESKTOP_ISLAND);
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

  test("pasek „Na czasie”: ruch ozdobny dopiero po pierwszej interakcji", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await prepare(page);
    await routeGuest(page);
    await open(page);
    // Punkt ciszy (zapas bez interakcji) zapada najwcześniej 5 s po `load`.
    expect(await tickerMotion(page)).toEqual({
      attribute: false,
      flame: "none",
      ribbon: "none",
      livePing: "none",
    });
    await interactAndWaitForMotion(page);
    expect(await tickerMotion(page)).toEqual({
      attribute: true,
      flame: "tt-flame-flicker",
      ribbon: "tt-ribbon-shift",
      livePing: "tt-live-ping",
    });
  });

  test("pasek „Na czasie”: prefers-reduced-motion wyłącza ruch ozdobny", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(DESKTOP);
    await prepare(page);
    await routeGuest(page);
    await open(page);
    await interactAndWaitForMotion(page);
    expect(await tickerMotion(page)).toEqual({
      attribute: true,
      flame: "none",
      ribbon: "none",
      livePing: "none",
    });
  });
});
