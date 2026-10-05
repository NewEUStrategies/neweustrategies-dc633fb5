// Tag Google poza śladem (P1.1, TP-1 + TP-2) w prawdziwej przeglądarce, na
// artefakcie `build:smoke` (playwright.performance.config.ts, backend fixture).
//
// CO JEST PRZYPINANE.
//  1. Bez interakcji: ŻADNEGO żądania do hostów Google przed `load` + 5 s i
//     przed 5 s ciszy (bez długich zadań i bez liczonych zasobów - ta sama
//     lista ignorowanych co w `whenQuiescent.ts`); gtag.js dojeżdża w punkcie
//     ciszy, najpóźniej na limicie 20 s po `load`.
//  2. `page.mouse.down()` (samo wciśnięcie, bez puszczenia) ładuje gtag w
//     ≤ 1 s: po zapasie strażnika gestu kolejki P0.3 (300 ms) i po klatce.
//     Kolejność „gtag ostatni” wobec innych klas kolejki przypina
//     `gtagLoadPolicy.test.ts` na prawdziwej kolejce - w tym buildzie gtag
//     jest jej jedynym konsumentem (powłoka zgód P1.3 i wyspy P1.6 dojdą).
//  3. Przed zgodą marketingową w warstwie danych nie ma `config AW-…`, a
//     atrapa gtag.js (jak prawdziwy kontener G) nie dociąga kontenera Ads; po
//     „Akceptuj wszystkie” - dokładnie jedno `config AW`, ZA `consent update`
//     z `ad_storage: granted`, i jeden kontener Ads; powracający odwiedzający
//     po przeładowaniu - znowu dokładnie jedno, znowu za aktualizacją zgody.
//  4. Kontrole negatywne: programowe przewinięcie ELEMENTU (karuzela, zaufane
//     zdarzenie `scroll`) i zdarzenia wysłane skryptem (`isTrusted: false`)
//     nie ładują gtag; kółko myszy - ładuje.
//  5. Polityka gtag (z prymitywami P0.3) jest POZA zamknięciem bootu:
//     `ConsentScriptInjector` ładuje ją leniwym `import()` po hydratacji, więc
//     dokument nie ma do jej chunku (`gtagLoadPolicy-*.js`) ani
//     `modulepreload`, ani wpisu w nagłówku `Link`, a chunk dojeżdża bez
//     interakcji (przypadek 1).
//
// LENIWA POLITYKA A OCZEKIWANIE NA INJECTOR. Aktualizacja zgody w warstwie
// danych (efekt injectora) nie znaczy już, że kolejka P0.3 ma wpis gtag:
// polityka zakłada sygnały dopiero po dojeździe swojego chunku.
// `waitForInjector()` czeka więc także na `waitForGtagPolicy()` - wpis
// Resource Timing chunku i `import()` tego samego adresu w stronie (ta sama
// instancja modułu z mapy modułów, rozstrzygnięcie po jej ewaluacji), żeby
// interakcja w przypadkach 2-4 szła torem nasłuchu, a nie lepkiej aktywacji.
//
// ATRAPA. Hosty Google odpowiada `page.route`: `gtag/js` to mała atrapa, która
// zapisuje swoje uruchomienie i - jak kontener G - dociąga
// `gtag/js?id=AW-…`, gdy w warstwie danych jest `config AW-…`; pingi dostają
// 204. Bramkę hosta (`tagIds.ts`) otwiera flaga testowa
// `__NES_GA_ANY_HOST__`, ustawiona przed snippetem SSR.
//
// UTRZYMANIE RUCHU (przypadki 2-4). Strona co sekundę pobiera
// `/favicon.ico?…` - liczony zasób, który przesuwa okno ciszy - więc punkt
// ciszy zapada dopiero na limicie 20 s po `load`, a sygnałem w tych
// przypadkach jest wyłącznie interakcja (albo jej brak).
//
// MASKA AKTYWACJI UŻYTKOWNIKA (`prepare()`). Playwright wykonuje własne
// ewaluacje przez CDP z `userGesture: true` (także `page.evaluate` i
// `waitForFunction` tego speca), a to nadaje dokumentowi LEPKĄ AKTYWACJĘ
// (`navigator.userActivation.hasBeenActive === true`) tuż po `load` - bez
// żadnego zdarzenia wejścia. `firstInteraction.ts` (P0.3) przy zakładaniu
// nasłuchu czyta lepką aktywację jako interakcję sprzed subskrypcji
// (kliknięcie przed hydratacją) i zwalnia kolejkę, więc w tym harnessie
// gtag wchodził ok. 1,2-2,1 s po starcie, choć nikt nie dotknął strony
// (diagnoza: raport Prove P1.1, §3 - przypadki 1 i 4 czerwone). W prawdziwej
// przeglądarce i w Lighthouse nowy dokument nie ma aktywacji bez wejścia
// (księga B: zero gtag w śladzie w 10/10 przebiegów), dlatego spec podmienia
// `Navigator.prototype.userActivation` na wartość, która staje się `true`
// dopiero po pierwszym ZAUFANYM zdarzeniu aktywującym z HTML
// (`keydown`/`mousedown`/`pointerdown`/`pointerup`/`touchend`; kółko i
// przewinięcie NIE aktywują) - jak aktywacja z prawdziwego wejścia. Maskę
// sprawdza sam spec (`maskedActivation`): przed interakcją `false`, po
// `mouse.down()` `true`. Przy leniwej polityce (punkt 5) maska ma drugie
// zadanie: interakcja sprzed dojazdu chunku zwalnia kolejkę WYŁĄCZNIE przez
// lepką aktywację, więc fałszywa aktywacja z CDP zafałszowałaby każdy wynik.
//
// Uruchamianie (wyłącznie pod mutexem maszyny, na zbudowanym worktree):
//   bunx playwright test --config playwright.performance.config.ts \
//     e2e-performance/third-party-quiescence.spec.ts
import { expect, test, type Page } from "@playwright/test";
import {
  fixtureImage,
  fixtureResponse,
  homeFixture,
  isFixtureBackend,
} from "../scripts/performance/homeFixture";

/** Hosty tagu Google (jak `GOOGLE_HOST` w `whenQuiescent.ts`). */
const GOOGLE_HOST =
  /(^|\.)(googletagmanager\.com|google-analytics\.com|googleadservices\.com|googlesyndication\.com|doubleclick\.net|google\.[a-z]{2,3}(\.[a-z]{2})?)$/i;
const GTAG_G_PREFIX = "https://www.googletagmanager.com/gtag/js?id=G-";
const GTAG_AW_PREFIX = "https://www.googletagmanager.com/gtag/js?id=AW-";
/** Zapas strażnika gestu kolejki P0.3 (`GESTURE_FALLBACK_MS`). */
const GESTURE_FALLBACK_MS = 300;
const QUIESCENCE_MIN_AFTER_LOAD_MS = 5_000;
const QUIESCENCE_WINDOW_MS = 5_000;
const QUIESCENCE_CAP_MS = 20_000;
const ACCEPT_ALL = /Akceptuj wszystkie|Accept all/i;
/** Chunk leniwej polityki gtag (nazwa od modułu `gtagLoadPolicy.ts`, hash Vite). */
const GTAG_POLICY_CHUNK = /\/gtagLoadPolicy-[\w-]+\.js$/;

/**
 * Atrapa gtag.js: zapisuje uruchomienie w `window.__gtagStub`; kontener G
 * dociąga kontener Ads tylko z `config AW-…` w warstwie danych (także
 * wypchniętego później - przechwycony `dataLayer.push`), jak prawdziwy tag.
 */
const GTAG_STUB = [
  "(function(){",
  "var w=window,c=document.currentScript,id=c&&c.src?new URL(c.src).searchParams.get('id')||'':'';",
  "(w.__gtagStub=w.__gtagStub||[]).push({id:id,at:performance.now()});",
  "if(id.indexOf('G-')!==0)return;",
  "var dl=w.dataLayer=w.dataLayer||[],loaded={};",
  "function aw(a){if(a&&a[0]==='config'&&typeof a[1]==='string'&&a[1].indexOf('AW-')===0&&!loaded[a[1]]){",
  "loaded[a[1]]=1;var s=document.createElement('script');s.async=true;",
  "s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(a[1])+'&cx=c';document.head.appendChild(s);}}",
  "for(var i=0;i<dl.length;i++)aw(dl[i]);",
  "var push=dl.push;dl.push=function(){for(var j=0;j<arguments.length;j++)aw(arguments[j]);return push.apply(dl,arguments);};",
  "})();",
].join("");

interface TimedResource {
  readonly name: string;
  readonly startTime: number;
  readonly end: number;
  readonly initiatorType: string;
}

interface Timeline {
  readonly now: number;
  readonly loadEventStart: number;
  readonly resources: readonly TimedResource[];
  readonly longTaskEnds: readonly number[];
  readonly pointerdownAt: number | null;
  readonly trustedElementScrolls: number;
}

/**
 * Flaga hosta, maska aktywacji użytkownika, sondy (pierwsze zaufane
 * `pointerdown`, długie zadania) i bufor Resource Timing.
 */
async function prepare(page: Page, options: { keepBusy: boolean }): Promise<void> {
  await page.addInitScript((keepBusy: boolean) => {
    // Maska lepkiej aktywacji nadawanej przez ewaluacje CDP Playwrighta -
    // patrz MASKA AKTYWACJI w nagłówku. Skrypt biegnie przed skryptami strony,
    // więc `firstInteraction.ts` widzi wyłącznie wartość z maski.
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

    Reflect.set(window, "__NES_GA_ANY_HOST__", true);
    // Domyślny bufor (250 wpisów) mógłby zgubić wpis gtag na bogatej stronie.
    performance.setResourceTimingBufferSize(5_000);
    const probe = { pointerdownAt: null as number | null, longTaskEnds: [] as number[] };
    Reflect.set(window, "__p11Probe", probe);
    window.addEventListener(
      "pointerdown",
      (event) => {
        if (event.isTrusted && probe.pointerdownAt === null) probe.pointerdownAt = event.timeStamp;
      },
      { capture: true, passive: true },
    );
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          probe.longTaskEnds.push(entry.startTime + entry.duration);
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Bez `longtask` - zostaje cisza zasobów (jak w detektorze).
    }
    if (keepBusy) {
      let n = 0;
      window.setInterval(() => {
        n += 1;
        void fetch(`/favicon.ico?p11-keepalive=${n}`, { cache: "no-store" }).catch(() => {});
      }, 1_000);
    }
  }, options.keepBusy);

  await page.route(
    (url) => url.hostname !== "127.0.0.1" || isFixtureBackend(url.href),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (GOOGLE_HOST.test(url.hostname)) {
        if (url.hostname === "www.googletagmanager.com" && url.pathname === "/gtag/js") {
          return route.fulfill({
            status: 200,
            contentType: "application/javascript; charset=utf-8",
            body: GTAG_STUB,
          });
        }
        return route.fulfill({ status: 204, body: "" });
      }
      if (isFixtureBackend(request.url())) {
        const response = await fixtureResponse(
          new Request(request.url(), {
            method: request.method(),
            headers: request.headers(),
            body: request.method() === "POST" ? request.postData() : undefined,
          }),
          { delayMs: 40 },
        );
        return route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: await response.text(),
        });
      }
      if (request.resourceType() === "image") {
        return route.fulfill({ body: fixtureImage, contentType: homeFixture.fixture_image_type });
      }
      return route.continue();
    },
  );
}

async function timeline(page: Page): Promise<Timeline> {
  return page.evaluate(() => {
    const [navigation] = performance.getEntriesByType("navigation");
    const loadEventStart =
      navigation && "loadEventStart" in navigation && typeof navigation.loadEventStart === "number"
        ? navigation.loadEventStart
        : 0;
    const probe = Reflect.get(window, "__p11Probe") as
      { pointerdownAt: number | null; longTaskEnds: number[] } | undefined;
    const scrolls = Reflect.get(window, "__p11ElementScrolls");
    return {
      now: performance.now(),
      loadEventStart,
      resources: performance.getEntriesByType("resource").map((entry) => ({
        name: entry.name,
        startTime: entry.startTime,
        end: entry.startTime + entry.duration,
        initiatorType:
          "initiatorType" in entry && typeof entry.initiatorType === "string"
            ? entry.initiatorType
            : "",
      })),
      longTaskEnds: probe ? [...probe.longTaskEnds] : [],
      pointerdownAt: probe ? probe.pointerdownAt : null,
      trustedElementScrolls: typeof scrolls === "number" ? scrolls : 0,
    };
  });
}

/**
 * Aktywacja widziana przez stronę (wartość z maski). `false` przed
 * interakcją dowodzi, że maska działa mimo ewaluacji z `userGesture: true`
 * (to wywołanie też jest taką ewaluacją) i że nie było zaufanego wejścia.
 */
async function maskedActivation(page: Page): Promise<boolean> {
  return page.evaluate(() => navigator.userActivation.hasBeenActive);
}

function isGoogle(resource: TimedResource): boolean {
  try {
    return GOOGLE_HOST.test(new URL(resource.name).hostname);
  } catch {
    return false;
  }
}

function gtagScripts(t: Timeline, prefix = GTAG_G_PREFIX): TimedResource[] {
  return t.resources.filter((resource) => resource.name.startsWith(prefix));
}

function firstGtag(t: Timeline): TimedResource {
  const [gtag] = gtagScripts(t);
  if (!gtag) throw new Error("brak wpisu Resource Timing dla gtag.js");
  return gtag;
}

/** Czy zasób przesuwa okno ciszy - lustro listy ignorowanych z `whenQuiescent.ts`. */
function isCounted(resource: TimedResource, t: Timeline, origin: string): boolean {
  if (resource.initiatorType === "img" && resource.startTime >= t.loadEventStart) return false;
  if (isGoogle(resource)) return false;
  const url = new URL(resource.name);
  if (url.origin === origin) {
    for (const path of ["/api/public/version", "/~flock.js", "/~api/analytics"]) {
      if (url.pathname === path || url.pathname.startsWith(`${path}/`)) return false;
    }
  }
  return true;
}

async function waitForGtag(page: Page, timeout: number, prefix = GTAG_G_PREFIX): Promise<void> {
  await page.waitForFunction(
    (wanted) => performance.getEntriesByType("resource").some((e) => e.name.startsWith(wanted)),
    prefix,
    { timeout, polling: 50 },
  );
}

/**
 * Polityka gtag jest ZAŁOŻONA (patrz LENIWA POLITYKA w nagłówku): wpis
 * Resource Timing chunku `gtagLoadPolicy-*.js`, a potem `import()` tego samego
 * adresu w stronie. Mapa modułów oddaje tę samą instancję i rozstrzyga promise
 * po jej ewaluacji; reakcja injectora (`scheduleGtagLoad`) siedzi w tej samej
 * kolejce mikrozadań, a makrozadanie `setTimeout(0)` domyka ją na pewno.
 * Zwraca adres chunku.
 */
async function waitForGtagPolicy(page: Page): Promise<string> {
  const handle = await page.waitForFunction(
    (source) => {
      const pattern = new RegExp(source);
      const entry = performance
        .getEntriesByType("resource")
        .find((candidate) => pattern.test(new URL(candidate.name).pathname));
      return entry ? entry.name : false;
    },
    GTAG_POLICY_CHUNK.source,
    { timeout: 10_000, polling: 50 },
  );
  const chunk = await handle.jsonValue();
  if (typeof chunk !== "string") throw new Error("brak chunku polityki gtag w Resource Timing");
  await page.evaluate(async (url) => {
    await import(url);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }, chunk);
  return chunk;
}

/**
 * Bootstrap GA4 i polityka gtag są założone: `ConsentScriptInjector` wypycha
 * `consent update` w efekcie zadeklarowanym PO efekcie bootstrapu (bootstrap
 * zamówił już leniwy chunk polityki), a `waitForGtagPolicy()` czeka, aż
 * polityka założy wpis gtag w kolejce P0.3.
 */
async function waitForInjector(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const layer: unknown = Reflect.get(window, "dataLayer");
    return (
      Array.isArray(layer) &&
      layer.some(
        (entry) =>
          Object.prototype.toString.call(entry) === "[object Arguments]" &&
          (entry as ArrayLike<unknown>)[0] === "consent" &&
          (entry as ArrayLike<unknown>)[1] === "update",
      )
    );
  });
  await waitForGtagPolicy(page);
}

/** `config AW-…` w warstwie danych: liczba i czy przed pierwszym stała aktualizacja z `ad_storage: granted`. */
async function adsConfig(page: Page): Promise<{ count: number; afterGrantedUpdate: boolean }> {
  return page.evaluate(() => {
    const layer: unknown = Reflect.get(window, "dataLayer");
    const commands = (Array.isArray(layer) ? layer : []).filter(
      (entry) => Object.prototype.toString.call(entry) === "[object Arguments]",
    ) as ArrayLike<unknown>[];
    const isAds = (entry: ArrayLike<unknown>) =>
      entry[0] === "config" && typeof entry[1] === "string" && entry[1].startsWith("AW-");
    const first = commands.findIndex(isAds);
    const grantedBefore = commands
      .slice(0, Math.max(0, first))
      .some(
        (entry) =>
          entry[0] === "consent" &&
          entry[1] === "update" &&
          (entry[2] as Record<string, unknown> | undefined)?.ad_storage === "granted",
      );
    return {
      count: commands.filter(isAds).length,
      afterGrantedUpdate: first >= 0 && grantedBefore,
    };
  });
}

test.describe("tag Google poza śladem (P1.1)", () => {
  test("bez interakcji: żadnego żądania Google przed load + 5 s i przed 5 s ciszy; gtag w punkcie ciszy", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await prepare(page, { keepBusy: false });
    const response = await page.goto("/", { waitUntil: "load" });
    expect(response?.status()).toBe(200);

    // Polityka gtag poza zamknięciem bootu: dokument nie preloaduje jej chunku
    // (ani `<link>`, ani nagłówek `Link`), a chunk dojeżdża po hydratacji bez
    // interakcji - polityka zakłada sygnały, z punktem ciszy włącznie.
    expect(response?.headers().link ?? "").not.toMatch(/gtagLoadPolicy-/);
    const preloaded = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('link[rel="modulepreload"], link[rel="preload"]'),
        (link) => link.getAttribute("href") ?? "",
      ),
    );
    expect(preloaded.length).toBeGreaterThan(0);
    expect(preloaded.filter((href) => GTAG_POLICY_CHUNK.test(href))).toEqual([]);
    await waitForGtagPolicy(page);

    await page.waitForFunction(
      (margin) => {
        const [navigation] = performance.getEntriesByType("navigation");
        const load =
          navigation &&
          "loadEventStart" in navigation &&
          typeof navigation.loadEventStart === "number"
            ? navigation.loadEventStart
            : 0;
        return load > 0 && performance.now() >= load + margin;
      },
      QUIESCENCE_MIN_AFTER_LOAD_MS - 500,
      { timeout: 20_000, polling: 100 },
    );
    const early = await timeline(page);
    expect(early.resources.filter(isGoogle).map((resource) => resource.name)).toEqual([]);
    expect(await maskedActivation(page)).toBe(false);

    await waitForGtag(page, QUIESCENCE_CAP_MS + 10_000);
    const t = await timeline(page);
    const gtag = firstGtag(t);
    expect(gtag.startTime).toBeGreaterThanOrEqual(t.loadEventStart + QUIESCENCE_MIN_AFTER_LOAD_MS);

    // Reguła punktu ciszy, policzona z tych samych wpisów co detektor: 5 s od
    // ostatniego długiego zadania i ostatniego LICZONEGO zasobu - albo limit.
    // Aktywność z ostatnich 250 ms przed gtag (klatka + zadanie kolejki po
    // punkcie) nie mogła wpłynąć na decyzję, więc jej nie liczymy.
    const origin = new URL(page.url()).origin;
    const cutoff = gtag.startTime - 250;
    const lastActivity = Math.max(
      t.loadEventStart,
      ...t.resources
        .filter((resource) => resource.end <= cutoff && isCounted(resource, t, origin))
        .map((resource) => resource.end),
      ...t.longTaskEnds.filter((end) => end <= cutoff),
    );
    const byCap = gtag.startTime >= t.loadEventStart + QUIESCENCE_CAP_MS;
    expect(
      byCap || gtag.startTime - lastActivity >= QUIESCENCE_WINDOW_MS - 1,
      `gtag ${gtag.startTime.toFixed(0)} ms, ostatnia aktywność ${lastActivity.toFixed(0)} ms, load ${t.loadEventStart.toFixed(0)} ms`,
    ).toBe(true);

    // Nic z hostów Google przed samym gtag.js; bez zgody marketingowej - ani
    // `config AW`, ani kontenera Ads.
    expect(
      t.resources
        .filter((resource) => isGoogle(resource) && resource.startTime < gtag.startTime)
        .map((resource) => resource.name),
    ).toEqual([]);
    await page.waitForTimeout(500);
    expect(gtagScripts(await timeline(page), GTAG_AW_PREFIX)).toEqual([]);
    expect((await adsConfig(page)).count).toBe(0);
  });

  test("page.mouse.down() ładuje gtag w ≤ 1 s, po zapasie strażnika gestu i klatce", async ({
    page,
  }) => {
    await prepare(page, { keepBusy: true });
    await page.goto("/", { waitUntil: "load" });
    await waitForInjector(page);
    const before = await timeline(page);
    expect(before.resources.filter(isGoogle)).toEqual([]);
    // Jedynym źródłem zwolnienia ma być `pointerdown` poniżej: przed nim
    // strona nie widzi aktywacji ani nie ma zapisanego zaufanego wciśnięcia.
    expect(await maskedActivation(page)).toBe(false);
    expect(before.pointerdownAt).toBeNull();

    await page.mouse.move(8, 400);
    await page.mouse.down();
    try {
      await waitForGtag(page, 3_000);
    } finally {
      await page.mouse.up();
    }

    const t = await timeline(page);
    const gtag = firstGtag(t);
    expect(t.pointerdownAt).not.toBeNull();
    expect(await maskedActivation(page)).toBe(true);
    const delay = gtag.startTime - (t.pointerdownAt ?? 0);
    expect(delay, `gtag ${delay.toFixed(0)} ms po pointerdown`).toBeLessThanOrEqual(1_000);
    // Strażnik gestu: krok kolejki nie rusza w trakcie wciśnięcia (zapas 300 ms).
    expect(delay).toBeGreaterThanOrEqual(GESTURE_FALLBACK_MS - 5);
    // Sygnałem była interakcja, nie punkt ciszy (ruch strony trzyma okno).
    expect(gtag.startTime).toBeLessThan(t.loadEventStart + QUIESCENCE_CAP_MS);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const runs: unknown = Reflect.get(window, "__gtagStub");
          return Array.isArray(runs) ? runs.length : 0;
        }),
      )
      .toBe(1);
  });

  test("Google Ads dopiero po zgodzie marketingowej: przed - zero `config AW` i kontenera Ads, po - dokładnie jeden, za `consent update`", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await prepare(page, { keepBusy: true });
    await page.goto("/", { waitUntil: "load" });
    await waitForInjector(page);
    expect((await adsConfig(page)).count).toBe(0);

    // Interakcja ładuje gtag BEZ zgody marketingowej: kontener G rusza, Ads - nie.
    await page.mouse.move(8, 400);
    await page.mouse.wheel(0, 120);
    await waitForGtag(page, 2_000);
    await page.waitForTimeout(500);
    expect(gtagScripts(await timeline(page), GTAG_AW_PREFIX)).toEqual([]);
    expect((await adsConfig(page)).count).toBe(0);

    await page.getByRole("button", { name: ACCEPT_ALL }).first().click();
    await expect.poll(async () => (await adsConfig(page)).count).toBe(1);
    expect((await adsConfig(page)).afterGrantedUpdate).toBe(true);
    await waitForGtag(page, 2_000, GTAG_AW_PREFIX);
    await page.waitForTimeout(300);
    expect(gtagScripts(await timeline(page), GTAG_AW_PREFIX)).toHaveLength(1);

    // Powracający odwiedzający (decyzja zapisana): znowu dokładnie jedno
    // `config AW`, znowu za aktualizacją zgody.
    await page.reload({ waitUntil: "load" });
    await waitForInjector(page);
    await expect.poll(async () => (await adsConfig(page)).count).toBe(1);
    expect(await adsConfig(page)).toEqual({ count: 1, afterGrantedUpdate: true });
  });

  test("programowe przewinięcie ELEMENTU i zdarzenia niezaufane nie ładują gtag; kółko myszy - ładuje", async ({
    page,
  }) => {
    await prepare(page, { keepBusy: true });
    await page.goto("/", { waitUntil: "load" });
    await waitForInjector(page);

    await page.evaluate(() => {
      // Tor jak w autoodtwarzanej karuzeli: `scrollTo` na przewijanym elemencie
      // emituje ZAUFANY `scroll` bez udziału odwiedzającego.
      const track = document.createElement("div");
      track.style.cssText =
        "position:fixed;left:0;top:0;width:200px;height:40px;overflow:auto;opacity:0;pointer-events:none";
      const lane = document.createElement("div");
      lane.style.cssText = "width:4000px;height:10px";
      track.append(lane);
      document.body.append(track);
      let trusted = 0;
      track.addEventListener("scroll", (event) => {
        if (event.isTrusted) trusted += 1;
        Reflect.set(window, "__p11ElementScrolls", trusted);
      });
      track.scrollTo({ left: 600 });
      window.setTimeout(() => track.scrollTo({ left: 1_200 }), 300);
      // Zdarzenia wysłane skryptem (`isTrusted === false`).
      for (const type of ["pointerdown", "keydown", "touchstart", "wheel"]) {
        window.dispatchEvent(new Event(type, { bubbles: true }));
      }
      document.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(1_500);

    const t = await timeline(page);
    expect(t.trustedElementScrolls).toBeGreaterThan(0);
    expect(await maskedActivation(page)).toBe(false);
    expect(gtagScripts(t)).toEqual([]);
    // Okno kontroli negatywnej skończyło się przed limitem punktu ciszy.
    expect(t.now).toBeLessThan(t.loadEventStart + QUIESCENCE_CAP_MS);

    await page.mouse.move(8, 400);
    await page.mouse.wheel(0, 120);
    await waitForGtag(page, 1_000);
  });
});
