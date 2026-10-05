import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
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
//  6. DOKUMENT W DWÓCH PORCJACH ROZCIĘTYCH W ŚRODKU KARTY (P1.3b, bramka fali
//     1, kryterium (d)): pośrednik HTTP wysyła HTML do połowy powłoki, czeka
//     `SPLIT_PAUSE_MS`, potem resztę. W przerwie karta jest ukryta (nie ma
//     uciętej wersji do namalowania), a `PerformanceObserver('layout-shift')`
//     nie widzi ŻADNEGO przesunięcia, którego źródło leży w powłoce. Kontrola
//     negatywna: na drzewie bez skryptu odsłonięcia (baza `67c87e16`) ten sam
//     przypadek wykrywa przesunięcie karty rosnącej w górę.
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
/** Źródło przesunięcia z wpisu `layout-shift`, policzone w chwili wpisu (węzeł może potem zniknąć). */
interface ShiftSourceSample {
  node: string;
  /** Węzeł leży w `[data-consent-shell]`. */
  shell: boolean;
  previous: number[];
  current: number[];
}
interface ShiftSample {
  value: number;
  startTime: number;
  hadRecentInput: boolean;
  sources: ShiftSourceSample[];
}
declare global {
  interface Window {
    __lcp: LcpSample[];
    __shifts: ShiftSample[];
    __nesAppReady?: boolean;
  }
}

const DEVICES = [
  {
    name: "mobile 412x823 @1,75",
    viewport: { width: 412, height: 823 },
    scale: 1.75,
    mobile: true,
  },
  { name: "desktop 1350x940 @1", viewport: { width: 1350, height: 940 }, scale: 1, mobile: false },
];

for (const device of DEVICES) {
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

// ---------- Dokument w dwóch porcjach rozciętych w środku karty (P1.3b) ----------

/**
 * Przerwa między porcjami dokumentu. Z zapasem ponad przykład z planu
 * (300-500 ms): w przerwie przeglądarka musi pobrać arkusz, sparsować ok.
 * 200 KB i namalować klatkę także na obciążonej maszynie pomiarowej. Że
 * próbka padła W PRZERWIE (po FCP, przed resztą karty), pilnuje sam test.
 */
const SPLIT_PAUSE_MS = 800;

/** Nagłówki żądania, których pośrednik nie przekazuje (`fetch` z undici ich nie przyjmuje albo liczy sam). */
const DROPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "upgrade",
  "expect",
  "transfer-encoding",
  "accept-encoding",
  "content-length",
]);
/** Nagłówki odpowiedzi, których pośrednik nie przepisuje (`fetch` zdekodował treść). */
const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "set-cookie",
]);

interface SplitPoint {
  /** Bajt cięcia w dokumencie (porcja 1 = `[0, at)`). */
  at: number;
  total: number;
}

interface SplitProxy {
  origin: string;
  /** Rozstrzyga się, gdy pierwsza porcja dokumentu jest wysłana. */
  firstPart: Promise<SplitPoint>;
  close: () => Promise<void>;
}

/**
 * Bajt cięcia: tuż za `</h2>` tytułu karty powłoki. Porcja 1 niesie korzeń
 * karty i wiersz nagłówka, porcja 2 - akapit, przyciski, koniec gniazda
 * (i na drzewie z P1.3b skrypt odsłonięcia). `-1`, gdy powłoki nie ma.
 */
function splitInsideShell(html: Buffer): number {
  const shell = html.indexOf('data-consent-shell=""');
  if (shell < 0) return -1;
  const title = html.indexOf("</h2>", shell);
  return title < 0 ? -1 : title + "</h2>".length;
}

/**
 * Pośrednik HTTP przed serwerem artefaktu: każde żądanie przekazuje bez zmian,
 * a PIERWSZY dokument HTML wysyła w dwóch porcjach z przerwą `pauseMs`
 * (kodowanie `chunked`). Osobny port zamiast `page.route`: `route.fulfill`
 * oddaje treść w całości, więc parser nigdy nie czekałby na dane w środku karty.
 */
async function startSplitProxy(upstream: string, pauseMs: number): Promise<SplitProxy> {
  let resolveFirst!: (point: SplitPoint) => void;
  let rejectFirst!: (reason: Error) => void;
  const firstPart = new Promise<SplitPoint>((resolve, reject) => {
    resolveFirst = resolve;
    rejectFirst = reject;
  });
  let documentSent = false;

  const forward = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body: Buffer[] = [];
    for await (const chunk of req) body.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || DROPPED_REQUEST_HEADERS.has(name)) continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const reply = await fetch(new URL(req.url ?? "/", upstream), {
      method: req.method,
      headers,
      body: body.length > 0 ? Buffer.concat(body) : undefined,
      redirect: "manual",
    });
    const out: Record<string, string | string[]> = {};
    reply.headers.forEach((value, name) => {
      if (!DROPPED_RESPONSE_HEADERS.has(name)) out[name] = value;
    });
    const cookies = reply.headers.getSetCookie();
    if (cookies.length > 0) out["set-cookie"] = cookies;
    const payload = Buffer.from(await reply.arrayBuffer());
    const isDocument =
      req.method === "GET" && (reply.headers.get("content-type") ?? "").includes("text/html");
    res.writeHead(reply.status, out);
    if (!isDocument || documentSent) {
      res.end(payload);
      return;
    }
    documentSent = true;
    const at = splitInsideShell(payload);
    if (at < 0) {
      rejectFirst(new Error("w dokumencie nie ma karty powłoki zgód - nie ma czego rozciąć"));
      res.end(payload);
      return;
    }
    res.write(payload.subarray(0, at));
    resolveFirst({ at, total: payload.length });
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    res.end(payload.subarray(at));
  };

  const server = createServer({ noDelay: true }, (req, res) => {
    forward(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(502);
      res.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    firstPart,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Rejestrator wpisów `layout-shift` od początku dokumentu (z węzłami źródeł policzonymi od razu). */
async function recordLayoutShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface Source {
      node?: Node | null;
      previousRect: DOMRectReadOnly;
      currentRect: DOMRectReadOnly;
    }
    interface Entry extends PerformanceEntry {
      value: number;
      hadRecentInput: boolean;
      sources?: Source[];
    }
    const rect = (r: DOMRectReadOnly) => [r.x, r.y, r.width, r.height].map(Math.round);
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Entry[]) {
        window.__shifts.push({
          value: entry.value,
          startTime: Math.round(entry.startTime),
          hadRecentInput: entry.hadRecentInput,
          sources: (entry.sources ?? []).map((source) => {
            const node = source.node ?? null;
            const element = node instanceof Element ? node : (node?.parentElement ?? null);
            const role = element?.getAttribute("role");
            return {
              node: element
                ? `${element.tagName.toLowerCase()}${role ? `[role=${role}]` : ""}`
                : "",
              shell: !!element?.closest("[data-consent-shell]"),
              previous: rect(source.previousRect),
              current: rect(source.currentRect),
            };
          }),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

for (const device of DEVICES) {
  test.describe(`powłoka zgód w dwóch porcjach HTML - ${device.name}`, () => {
    test.use({
      viewport: device.viewport,
      deviceScaleFactor: device.scale,
      isMobile: device.mobile,
      hasTouch: device.mobile,
    });

    let proxy: SplitProxy | null = null;
    test.afterEach(async () => {
      await proxy?.close();
      proxy = null;
    });

    test("przerwa parsera w środku karty: brak uciętej karty i brak przesunięcia z powłoki", async ({
      page,
      baseURL,
    }, testInfo) => {
      proxy = await startSplitProxy(baseURL ?? "", SPLIT_PAUSE_MS);
      await recordLayoutShifts(page);
      await maskUserActivation(page);
      await routeFixture(page);
      const navigation = page.goto(`${proxy.origin}/`, { waitUntil: "load" });
      const split = await proxy.firstPart;

      // W PRZERWIE: pierwsza klatka treści jest, korzeń karty jest w DOM-ie,
      // a jej końca (panel preferencji) jeszcze nie ma.
      await page.waitForFunction(
        () =>
          performance.getEntriesByName("first-contentful-paint").length > 0 &&
          document.querySelector("[data-consent-shell]") !== null,
        undefined,
        { timeout: SPLIT_PAUSE_MS },
      );
      const during = await page.evaluate((selector) => {
        const shell = document.querySelector(selector);
        return {
          inPause: document.getElementById("cookie-preferences-inline") === null,
          display: shell ? getComputedStyle(shell).display : "",
          height: shell ? Math.round(shell.getBoundingClientRect().height) : 0,
        };
      }, SHELL);

      const response = await navigation;
      expect(response?.status()).toBe(200);
      const shell = page.locator(SHELL);
      await expect(shell).toBeVisible();
      // Wpisy `layout-shift` przychodzą po klatce - dwie klatki i chwila zapasu.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100))),
          ),
      );
      const shifts = await page.evaluate(() => window.__shifts);
      const final = await shell.evaluate((el) => Math.round(el.getBoundingClientRect().height));
      const shellShifts = shifts.filter((shift) => shift.sources.some((source) => source.shell));
      await testInfo.attach("przesuniecia.json", {
        body: JSON.stringify({ split, during, final, shifts }, null, 2),
        contentType: "application/json",
      });

      // Strażnik: próbka padła w przerwie - inaczej przypadek niczego nie sprawdza.
      expect(during.inPause, "próbka po drugiej porcji - zwiększ SPLIT_PAUSE_MS").toBe(true);
      expect(split.at).toBeLessThan(split.total);
      // Właściwe asercje (miękkie: kontrola negatywna ma pokazać obie).
      expect.soft(shellShifts, JSON.stringify(shellShifts)).toEqual([]);
      expect
        .soft(during.display, `ucięta karta widoczna w przerwie (${during.height} z ${final} px)`)
        .toBe("none");
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
