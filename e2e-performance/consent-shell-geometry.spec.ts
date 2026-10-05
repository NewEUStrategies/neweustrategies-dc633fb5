import { expect, test, type Page, type Route } from "@playwright/test";
import {
  fixtureImageFor,
  fixtureResponse,
  isAnalyticsScript,
  isFixtureBackend,
} from "../scripts/performance/homeFixture";

// POWŁOKA BANERA ZGÓD Z SSR (P1.3) NA ARTEFAKCIE PRODUKCYJNYM.
//
// Co tu dowodzimy (PLAN.md P1.3, „Weryfikacja"):
//  1. GEOMETRIA A ELEMENT LCP (krytyka M7, F30 - akapit banera bywał elementem
//     LCP): przy 412x823 @1,75 i 1350x940 @1 największy blok tekstu powłoki ma
//     MNIEJSZE pole niż widoczna część `img[data-lcp-candidate]`, a wpis
//     `largest-contentful-paint` wskazuje obraz kandydata, nie powłokę.
//  2. ODWIEDZAJĄCY Z DECYZJĄ (ciasteczko) NIE WIDZI POWŁOKI: `display: none`
//     już przy pierwszym malowaniu treści (FCP), zanim cokolwiek się uwodni.
//  3. KLIK W POWŁOCE PRZED HYDRATACJĄ zapisuje rekord natychmiast (skrypty
//     aplikacji wstrzymane), a nawigacja MPA przed bootem nie przywraca banera.
//  4. Baner interaktywny (chunk `ConsentBanner`) NIE jest pobierany bez
//     interakcji - powłoka wystarcza do końca pierwszego wejścia.
//  5. BEZ JAVASCRIPTU nie ma martwej karty (powłoka ukryta bez
//     `html[data-consent-js]`), a przy SYGNALE GPC powłoka jest ukryta od
//     pierwszego malowania i po boocie od razu wchodzi baner z notą GPC.
//
// Uruchomienie: `playwright test --config playwright.performance.config.ts
// e2e-performance/consent-shell-geometry.spec.ts` na zbudowanym artefakcie
// (`build:smoke`), backend fixture jak w pozostałych specach tego katalogu.

interface RouteOptions {
  /** Wstrzymaj skrypty aplikacji (moduły z `/assets/`) do odwołania. */
  holdScripts?: Promise<void>;
}

async function routeFixture(page: Page, { holdScripts }: RouteOptions = {}): Promise<void> {
  await page.route("**/*", async (route: Route) => {
    const request = route.request();
    if (isFixtureBackend(request.url())) {
      const reply = await fixtureResponse(
        new Request(request.url(), {
          method: request.method(),
          headers: request.headers(),
          body: request.method() === "POST" ? request.postData() : undefined,
        }),
        { delayMs: 40 },
      );
      return route.fulfill({
        status: reply.status,
        headers: Object.fromEntries(reply.headers),
        body: await reply.text(),
      });
    }
    if (isAnalyticsScript(request.url()))
      return route.fulfill({ body: "", contentType: "application/javascript" });
    // Raster dla okładek `.jpg` (jak pozostałe spece): wektor fixture ma przy
    // rozmiarze hero < 0,05 bpp i Chrome wyklucza go z LCP - wpisem zostawał
    // wtedy nagłówek treści, a nie `img[data-lcp-candidate]` (dowód P1.3, §5).
    if (request.resourceType() === "image") return route.fulfill(fixtureImageFor(request.url()));
    if (holdScripts && request.resourceType() === "script") await holdScripts;
    return route.continue();
  });
}

/**
 * MASKA AKTYWACJI (wzorzec `third-party-quiescence.spec.ts`, P1.1). Ewaluacje
 * Playwrighta idą przez CDP z `userGesture: true` i nadają dokumentowi lepką
 * aktywację bez żadnego wejścia; `firstInteraction.ts` (P0.3) czyta ją jako
 * kliknięcie sprzed subskrypcji i zwolniłby kolejkę - baner zgód montowałby się
 * „bez interakcji" wyłącznie w tym harnessie. Maska podmienia
 * `navigator.userActivation` na wartość, która staje się `true` dopiero po
 * pierwszym ZAUFANYM zdarzeniu aktywującym (jak w prawdziwej przeglądarce i w
 * Lighthouse).
 */
async function maskUserActivation(page: Page): Promise<void> {
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
}

const SHELL = "[data-consent-shell]";

interface LcpSample {
  url: string;
  tag: string;
  candidate: boolean;
}
declare global {
  interface Window {
    __lcp: LcpSample[];
    __nesAppReady?: boolean;
  }
}

for (const device of [
  {
    name: "mobile 412x823 @1,75",
    viewport: { width: 412, height: 823 },
    scale: 1.75,
    mobile: true,
  },
  { name: "desktop 1350x940 @1", viewport: { width: 1350, height: 940 }, scale: 1, mobile: false },
]) {
  test.describe(`powłoka zgód - ${device.name}`, () => {
    test.use({
      viewport: device.viewport,
      deviceScaleFactor: device.scale,
      isMobile: device.mobile,
      hasTouch: device.mobile,
    });

    test("największy blok tekstu powłoki < widoczny obraz LCP; LCP = kandydat", async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      const scripts: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.resourceType() === "script") scripts.push(new URL(request.url()).pathname);
      });
      await page.addInitScript(() => {
        window.__lcp = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<
            PerformanceEntry & { element?: Element | null; url?: string }
          >) {
            window.__lcp.push({
              url: entry.url ?? "",
              tag: entry.element?.tagName ?? "",
              candidate: !!entry.element?.closest?.("img[data-lcp-candidate]"),
            });
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
      });
      await maskUserActivation(page);
      await routeFixture(page);
      const response = await page.goto("/", { waitUntil: "load" });
      expect(response?.status()).toBe(200);
      expect(await response?.text()).toContain("data-consent-shell");

      const shell = page.locator(SHELL);
      await expect(shell).toBeVisible();
      await expect(shell).toHaveAttribute("data-nosnippet", "");
      await expect(shell).toHaveAttribute("role", "dialog");
      const candidate = page.locator("img[data-lcp-candidate]").first();
      await expect(candidate).toBeVisible();
      await expect
        .poll(() => candidate.evaluate((img) => (img as HTMLImageElement).complete))
        .toBe(true);

      const geometry = await page.evaluate((selector) => {
        const viewport = { w: window.innerWidth, h: window.innerHeight };
        const visibleArea = (rect: DOMRect) => {
          const w = Math.max(0, Math.min(rect.right, viewport.w) - Math.max(rect.left, 0));
          const h = Math.max(0, Math.min(rect.bottom, viewport.h) - Math.max(rect.top, 0));
          return w * h;
        };
        const root = document.querySelector(selector);
        const blocks = [...(root?.querySelectorAll("*") ?? [])].filter((el) =>
          [...el.childNodes].some(
            (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
          ),
        );
        const textBlocks = blocks.map((el) => ({
          tag: el.tagName,
          area: visibleArea(el.getBoundingClientRect()),
        }));
        const img = document.querySelector("img[data-lcp-candidate]");
        return {
          viewport,
          largestText: textBlocks.sort((a, b) => b.area - a.area)[0] ?? { tag: "", area: 0 },
          lcpImage: img ? visibleArea(img.getBoundingClientRect()) : 0,
        };
      }, SHELL);
      await testInfo.attach("geometria.json", {
        body: JSON.stringify(geometry, null, 2),
        contentType: "application/json",
      });
      expect(geometry.largestText.area).toBeGreaterThan(0);
      expect(geometry.lcpImage).toBeGreaterThan(0);
      expect(geometry.largestText.area).toBeLessThan(geometry.lcpImage);

      // Wpis LCP: ostatni kandydat to obraz `data-lcp-candidate`, nie tekst powłoki.
      await page.waitForTimeout(300);
      const lcp = await page.evaluate(() => window.__lcp);
      expect(lcp.length).toBeGreaterThan(0);
      expect(lcp.at(-1)?.candidate, JSON.stringify(lcp)).toBe(true);

      // Bez interakcji interaktywny baner NIE jest pobierany - powłoka wystarcza.
      await page.waitForFunction(() => window.__nesAppReady === true);
      await page.waitForTimeout(1500);
      expect(scripts.filter((path) => /\/ConsentBanner-/.test(path))).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("shell.png") });
      expect(errors).toEqual([]);
    });
  });
}

test("ciasteczko decyzji: powłoka `display: none` już przy pierwszym malowaniu", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const record = JSON.stringify({
    version: 2,
    ts: 1,
    categories: { necessary: true, functional: false, analytics: false, marketing: false },
    source: "local",
  });
  await context.addCookies([
    { name: "nes_cookie_consent", value: encodeURIComponent(record), url: baseURL ?? "" },
  ]);
  let releaseScripts!: () => void;
  const holdScripts = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await routeFixture(page, { holdScripts });
  try {
    // `commit`, nie `domcontentloaded`: skrypty modułowe są odroczone, więc
    // wstrzymane trzymałyby DOMContentLoaded do końca testu.
    await page.goto("/", { waitUntil: "commit" });
    await page.waitForSelector(SHELL, { state: "attached" });
    // Skrypty aplikacji wstrzymane: stan powłoki to wyłącznie HTML + skrypt inline.
    await page.waitForFunction(
      () => performance.getEntriesByName("first-contentful-paint").length > 0,
    );
    const state = await page.evaluate((selector) => {
      const shell = document.querySelector(selector);
      return {
        present: !!shell,
        display: shell ? getComputedStyle(shell).display : "",
        decided: document.documentElement.hasAttribute("data-consent-decided"),
        hydrated: window.__nesAppReady === true,
      };
    }, SHELL);
    await page.screenshot({ path: testInfo.outputPath("decided-fcp.png") });
    expect(state).toEqual({ present: true, display: "none", decided: true, hydrated: false });
  } finally {
    releaseScripts();
  }
  await page.waitForFunction(() => window.__nesAppReady === true);
  await expect(page.locator(SHELL)).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Zarządzaj swoją prywatnością" })).toHaveCount(0);
});

test("klik w powłoce przed hydratacją zapisuje rekord; nawigacja MPA przed bootem nie przywraca banera", async ({
  page,
  context,
}) => {
  let releaseScripts!: () => void;
  const holdScripts = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await routeFixture(page, { holdScripts });
  try {
    await page.goto("/", { waitUntil: "commit" });
    await page.waitForSelector(SHELL, { state: "attached" });
    const reject = page
      .locator(SHELL)
      .getByRole("button", { name: "Tylko niezbędne", exact: true });
    await expect(reject).toBeVisible();
    expect(await page.evaluate(() => window.__nesAppReady === true)).toBe(false);
    await reject.click();
    await expect(page.locator(SHELL)).toBeHidden();
    const stored = await page.evaluate(() => ({
      record: window.localStorage.getItem("consent:v2"),
      pending: window.localStorage.getItem("consent:shell-pending"),
    }));
    expect(JSON.parse(stored.record ?? "null")).toMatchObject({
      version: 2,
      categories: { necessary: true, functional: false, analytics: false, marketing: false },
      source: "local",
    });
    expect(stored.pending).toBe("1");
    const cookie = (await context.cookies()).find((c) => c.name === "nes_cookie_consent");
    expect(JSON.parse(decodeURIComponent(cookie?.value ?? "null"))).toMatchObject({
      version: 2,
      source: "local",
    });

    // Nawigacja dokumentu (MPA) - skrypty aplikacji nadal wstrzymane. Powłoka
    // stoi w HTML-u KAŻDEJ strony (po stopce), a wstrzymane skrypty modułowe
    // nie blokują parsera - czekamy, aż parser do niej dojdzie, i dopiero wtedy
    // sprawdzamy, że jest ukryta (recenzja P1.3, D4: „brak powłoki" nie może
    // przechodzić tylko dlatego, że parser jeszcze do niej nie doszedł).
    await page.goto("/en", { waitUntil: "commit" });
    await page.waitForSelector(SHELL, { state: "attached" });
    const display = await page.evaluate(
      (selector) => getComputedStyle(document.querySelector(selector) as Element).display,
      SHELL,
    );
    expect(display).toBe("none");
  } finally {
    releaseScripts();
  }
  // Boot domyka decyzję (profil/rejestr dla zalogowanych) i zdejmuje znacznik.
  await page.waitForFunction(() => window.__nesAppReady === true);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("consent:shell-pending")))
    .toBeNull();
  await expect(page.getByRole("dialog", { name: "Manage your privacy" })).toHaveCount(0);
});

test.describe("bez JavaScriptu", () => {
  test.use({ javaScriptEnabled: false });

  test("powłoka jest w HTML-u, ale ukryta - żadnej martwej karty bez działających przycisków", async ({
    page,
  }) => {
    await routeFixture(page);
    await page.goto("/", { waitUntil: "load" });
    const shell = page.locator(SHELL);
    await expect(shell).toHaveCount(1);
    await expect(shell).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.hasAttribute("data-consent-js")),
    ).toBe(false);
  });
});

test("GPC: powłoka ukryta od pierwszego malowania, po boocie baner z notą bez interakcji", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "globalPrivacyControl", {
      configurable: true,
      get: () => true,
    });
  });
  await maskUserActivation(page);
  let releaseScripts!: () => void;
  const holdScripts = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await routeFixture(page, { holdScripts });
  try {
    await page.goto("/", { waitUntil: "commit" });
    await page.waitForSelector(SHELL, { state: "attached" });
    const state = await page.evaluate(
      (selector) => ({
        gpc: document.documentElement.hasAttribute("data-consent-gpc"),
        display: getComputedStyle(document.querySelector(selector) as Element).display,
      }),
      SHELL,
    );
    expect(state).toEqual({ gpc: true, display: "none" });
  } finally {
    releaseScripts();
  }
  await page.waitForFunction(() => window.__nesAppReady === true);
  // Baner przejmuje gniazdo powłoki bez żadnego wejścia użytkownika.
  await expect(page.getByRole("dialog", { name: "Zarządzaj swoją prywatnością" })).toBeVisible();
  await expect(page.locator(SHELL)).toHaveCount(0);
});
