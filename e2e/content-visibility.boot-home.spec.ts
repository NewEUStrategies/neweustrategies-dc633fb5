import { expect, test, type Page } from "@playwright/test";

// CONTENT-VISIBILITY SEKCJI NA ARTEFAKCIE (P3.3): `/` na fixture `first-visit` (ten sam
// serwer i backend co `boot-home`, `playwright.artifact.config.ts`).
//
// Renderer treści owija ogon sekcji od indeksu 2 W DOKUMENCIE w opakowania z inline
// `content-visibility: auto` + `contain-intrinsic-size: auto <szacunek>px`
// (`BuilderRenderer.tsx`, blok „CONTENT-VISIBILITY SEKCJI"), więc przeglądarka pomija styl
// i układ sekcji daleko pod zgięciem w zadaniu pierwszej klatki. Ten plik przypina
// w prawdziwym Chromium to, czego test jednostkowy nie zmierzy (geometria):
//  1. HTML serwera: sekcje 0-1 bez cv, dalsze w opakowaniach z cv; na telefonie część z nich
//     jest naprawdę pominięta w pierwszej klatce, a każda sekcja w widoku jest wyrenderowana.
//  2. Przewinięcie kółkiem do końca strony: zero wpisów `layout-shift` przy przewijaniu przez
//     sekcje (dorysowują się ~1,5 ekranu przed widokiem, a zmiana wysokości pasa zastępczego
//     przesuwa tylko to, czego nie widać) i żaden wpis - także przy wczytaniu - nie pochodzi
//     z obszaru cv (opakowania, wszystko za pierwszym z nich, stopka).
//  3. Kotwica `#id` w dalszej sekcji na WOLNYM TELEFONIE (CDP: CPU x6; desktop bez dławienia):
//     po wczytaniu - `location.hash`, klik w link `#id`, wstecz/dalej między fragmentami - cel
//     staje tuż pod nagłówkiem i już z tego miejsca nie ucieka (próbka po każdej klatce aż do
//     spoczynku), także gdy cel stoi na samej górze sekcji, a pominięte sekcje nad nim mają
//     już ułożone poddrzewa (ktoś czytał w nich geometrię - w CI snapshotter trace'u
//     Playwrighta). Bez wyłącznika strażnika zakotwiczenie Chromium brało wtedy kotwicę
//     w pominiętej sekcji nad celem i wzrost tej sekcji spychał cel ~1000 px w dół (porażka
//     CI na `4d1e2791`: `top` 1239,875). Przy wejściu z fragmentem w adresie strażnik bloku
//     cv (`html[data-cv-off]`) zdejmuje cv przed parsowaniem sekcji i strona zachowuje się
//     jak bez P3.3.
//  4. Przeładowanie w połowie strony (przywrócenie przewinięcia TanStacka z
//     `sessionStorage`): strażnik zdejmuje cv i pozycja wraca jak na bazie; powrót „wstecz"
//     w SPA renderuje stronę po stronie klienta - bez cv, więc router liczy na prawdziwym
//     układzie.
//  5. Druk: reguła `@media print` zdejmuje cv (Chromium i tak drukuje pominięte sekcje).
//
// NAGŁÓWEK KURCZY SIĘ PRZY PIERWSZYM PRZEWINIĘCIU (tryb `sticky-shrink` strony głównej) i to
// on - nie cv - daje kilka wpisów `layout-shift` całego `<main>` (zmierzone na bazie fali
// bez P3.3: 4 wpisy po ~0,004 na telefonie, 7 na desktopie, wszystkie w pierwszych 350 ms
// przewijania). Dlatego scenariusz 2 liczy „zero" od chwili, gdy nagłówek stanie, a przez
// cały przebieg pilnuje, że żadne przesunięcie nie ma źródła w obszarze cv. Przy wczytaniu
// baza też bywa niestabilna przed tym obszarem (pojedyncze wpisy z nagłówka i hydratacji
// sekcji 0) - te wpisy trafiają tylko do adnotacji `load-shifts`.
//
// NAZWA PLIKU. Konfiguracja artefaktu bierze wyłącznie `boot-(artifact|timing|home)`
// (`testMatch`), więc spec jedzie razem z `boot-home` na tym samym zbudowanym serwerze.

interface ShiftEntry {
  value: number;
  t: number;
  sources: string[];
  /**
   * Któreś źródło leży w obszarze cv: w opakowaniu `[data-cv]` albo za pierwszym z nich
   * w kolejności dokumentu (dalsze sekcje, stopka). Tylko tam P3.3 może cokolwiek
   * przesunąć - nagłówek i sekcje 0-1 stoją przed opakowaniami, a blok cv jest `hidden`.
   */
  cvRegion: boolean;
}

interface SectionProbe {
  id: string;
  cv: string | null;
  contentVisibility: string;
  rendered: boolean;
  top: number;
  height: number;
}

/** Położenie celu kotwicy po jednej klatce (ms od nawigacji, px w widoku). */
interface TargetSample {
  t: number;
  top: number;
  /** Dół nagłówka (`sticky-shrink` kurczy się po skoku). */
  hb: number;
  y: number;
}

interface TargetTrack {
  /** `performance.now()` pierwszego `popstate` po starcie (nawigacja do fragmentu, wstecz/dalej). */
  navAt: number | null;
  /** ms od nawigacji do pierwszego `onRendered` routera po niej (`null` - jeszcze nie było). */
  renderedAfter: number | null;
  samples: TargetSample[];
}

declare global {
  interface Window {
    __nesAppReady?: boolean;
    __cvShifts?: ShiftEntry[];
    __cvTrack?: { start: (id: string) => void; rendered: () => boolean; stop: () => TargetTrack };
  }
}

const VIEWPORTS = [
  { name: "telefon", viewport: { width: 412, height: 823 } },
  { name: "desktop", viewport: { width: 1350, height: 940 } },
] as const;

/**
 * Wolny telefon w scenariuszach kotwicy: dławienie CPU przez CDP
 * (`Emulation.setCPUThrottlingRate`) od początku wczytania. Runner CI jest wolniejszy od
 * maszyny dewelopera, a lądowanie kotwicy zależy od kolejności zadań (skok, odsłonięcie sekcji
 * przez przeglądarkę, przewinięcie routera po renderze). Desktop jedzie bez dławienia.
 */
const PHONE_CPU_THROTTLE = 6;

async function throttleCpu(page: Page, rate: number): Promise<void> {
  if (rate <= 1) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

/** Wszystkie wpisy `layout-shift` od początku wczytania (także sprzed pierwszego odczytu). */
async function observeShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const list: ShiftEntry[] = [];
    window.__cvShifts = list;
    // `compareDocumentPosition` z pierwszego opakowania: FOLLOWING obejmuje też jego
    // potomków (CONTAINED_BY | FOLLOWING), a przodkowie (`<main>`) wychodzą jako PRECEDING.
    const inCvRegion = (node: Element) => {
      const first = document.querySelector("main [data-cv]");
      return (
        !!first &&
        (first === node ||
          (first.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
      );
    };
    type Source = {
      node?: Node | null;
      previousRect: DOMRectReadOnly;
      currentRect: DOMRectReadOnly;
    };
    const rect = (r: DOMRectReadOnly) =>
      `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    // Opis źródła do komunikatu porażki: znacznik, id, klasy, najbliższy znacznik `data-*`
    // (sekcja, wyspa, nagłówek) i prostokąty przed/po.
    const describe = ({ node, previousRect, currentRect }: Source): string => {
      if (!(node instanceof Element)) return String(node?.nodeName ?? "?");
      const sec = node.closest("[data-sec-id]")?.getAttribute("data-sec-id");
      const owner = node.closest(
        "[data-site-header], footer[data-site-footer], [data-island-id], [data-builder-renderer], main",
      );
      const ownerTag = owner
        ? `${owner.tagName.toLowerCase()}${[...owner.attributes]
            .filter((a) => a.name.startsWith("data-"))
            .slice(0, 2)
            .map((a) => `[${a.name}]`)
            .join("")}`
        : "-";
      return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}.${String(
        node.getAttribute("class") ?? "",
      )
        .split(/\s+/)
        .slice(0, 3)
        .join(
          ".",
        )}${sec ? ` w sekcji ${sec}` : ""} pod ${ownerTag}: ${rect(previousRect)} -> ${rect(currentRect)}`;
    };
    try {
      new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries() as Array<
          PerformanceEntry & { value: number; sources?: Source[] }
        >) {
          const sources = entry.sources ?? [];
          list.push({
            value: entry.value,
            t: Math.round(entry.startTime),
            sources: sources.map(describe),
            cvRegion: sources.some(({ node }) => node instanceof Element && inCvRegion(node)),
          });
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Brak API: lista zostaje pusta, a scenariusz 1 i tak sprawdza sekcje bez niej.
    }
  });
}

const shifts = (page: Page) => page.evaluate(() => structuredClone(window.__cvShifts ?? []));

async function openHome(page: Page, path = "/"): Promise<void> {
  await page.setExtraHTTPHeaders({ "accept-language": "pl" });
  await page.goto(path);
  await expect.poll(() => page.evaluate(() => window.__nesAppReady === true)).toBe(true);
}

/** Sekcje renderera treści strony (korzeń z nośnikiem kandydata LCP), w kolejności dokumentu. */
async function contentSections(page: Page): Promise<SectionProbe[]> {
  return page.evaluate(() => {
    const root = document.querySelector("main [data-lcp-root]");
    if (!root) return [];
    return [...root.querySelectorAll<HTMLElement>("[data-sec-id]")].map((el) => {
      const rect = el.getBoundingClientRect();
      const row = el.querySelector("[data-columns-row]");
      return {
        id: el.getAttribute("data-sec-id") ?? "",
        // cv siedzi na opakowaniu sekcji (razem ze szkieletem strumienia), nie na sekcji.
        cv: el.closest("[data-cv]")?.getAttribute("data-cv") ?? null,
        contentVisibility: getComputedStyle(el.closest("[data-cv]") ?? el).contentVisibility,
        rendered: row ? row.checkVisibility({ contentVisibilityAuto: true }) : false,
        top: rect.top,
        height: rect.height,
      };
    });
  });
}

async function wheel(page: Page, deltaY: number, steps: number, pauseMs = 60): Promise<void> {
  await page.mouse.move(200, 300);
  for (let step = 0; step < steps; step += 1) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(pauseMs);
  }
}

/**
 * Czeka, aż `scrollY` i dół nagłówka staną na 5 kolejnych odczytów co 100 ms. Po skoku do
 * kotwicy nagłówek `sticky-shrink` kurczy się z animacją, a zakotwiczenie przewijania koryguje
 * `scrollY` jeszcze ~1,1 s (zmierzone) - pomiar w trakcie widzi pozycję pośrednią. Pod
 * dławieniem CPU wszystko trwa kilka razy dłużej, stąd wyższy limit odczytów.
 */
async function settle(page: Page, maxPolls = 60): Promise<void> {
  let last = "";
  for (let polls = 0, stable = 0; polls < maxPolls && stable < 5; polls += 1) {
    await page.waitForTimeout(100);
    const now = await page.evaluate(
      () =>
        `${scrollY}|${document.querySelector("[data-site-header]")?.getBoundingClientRect().bottom}`,
    );
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
}

async function scrollToBottom(page: Page): Promise<void> {
  await page.mouse.move(200, 300);
  for (let step = 0; step < 300; step += 1) {
    const atBottom = await page.evaluate(
      () => Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1,
    );
    if (atBottom) break;
    await page.mouse.wheel(0, 360);
    await page.waitForTimeout(60);
  }
  // Sekcje i stopka dorysowane, ostatnie wpisy obserwatora dostarczone.
  await page.waitForTimeout(800);
}

interface AnchorTargets {
  /** Element z `id` w najdalszej sekcji treści od indeksu 2 (na fixture: nagłówek formularza „Dołącz" - cel z CI). */
  far: string;
  /**
   * Góra tej samej sekcji: `id` dopisany elementowi sekcji, jak nagłówek z kotwicą na początku
   * rich-textu. Bez przodka `overflow: hidden` działa pełny `scroll-margin-top`, więc po skoku
   * cel stoi ~2 x wysokość nagłówka pod górą widoku, a sekcja nad nim wchodzi w obszar, z którego
   * zakotwiczenie przewijania wybiera kotwicę (widok minus `scroll-padding-top`).
   */
  sectionTop: string;
  /** Góra drugiej sekcji z cv (do wstecz/dalej: daleko od dwóch pozostałych celów). */
  earlier: string;
  /** Liczba sekcji z cv przed sekcją celu `far`. */
  cvBefore: number;
  farInCv: boolean;
  earlierInCv: boolean;
}

async function anchorTargets(page: Page): Promise<AnchorTargets> {
  const targets = await page.evaluate(() => {
    const root = document.querySelector("main [data-lcp-root]");
    const sections = [...(root?.querySelectorAll<HTMLElement>("[data-sec-id]") ?? [])];
    const inCv = (el: Element) => !!el.closest("[data-cv]");
    const firstCv = sections.findIndex(inCv);
    for (let i = sections.length - 1; i >= 2; i -= 1) {
      const el = sections[i].querySelector("[id]");
      if (!el) continue;
      const earlier = sections[firstCv + 1];
      sections[i].id = "e2e-gora-sekcji-celu";
      earlier.id = "e2e-gora-wczesniejszej-sekcji";
      return {
        far: el.id,
        sectionTop: sections[i].id,
        earlier: earlier.id,
        cvBefore: sections.slice(0, i).filter(inCv).length,
        farInCv: inCv(sections[i]),
        earlierInCv: firstCv >= 0 && firstCv + 1 < i && inCv(earlier),
      };
    }
    return null;
  });
  expect(targets).not.toBeNull();
  expect(targets!.farInCv).toBe(true);
  expect(targets!.earlierInCv).toBe(true);
  expect(targets!.cvBefore).toBeGreaterThanOrEqual(2);
  return targets!;
}

/**
 * Pomiar geometrii w pominiętych sekcjach - jak pomiar widgetu przy hydratacji, skrypt
 * analityki czytający położenie elementów przy nawigacji albo snapshotter trace'u Playwrighta,
 * który przy każdej akcji czyta `scrollTop` każdego elementu (tak było w porażce z CI). Odczyt
 * wymusza ułożenie poddrzewa sekcji BEZ jej renderowania (opakowanie nadal stoi na pasie
 * z szacunku), a od tej chwili zakotwiczenie przewijania Chromium może wybrać kotwicę
 * W pominiętej sekcji nad celem - wzrost tej sekcji pod kotwicą nie jest kompensowany. Raz
 * teraz i przy każdym `popstate`, czyli tuż przed przewinięciem do fragmentu (nasłuch strony
 * po nasłuchach routera i strażnika cv). Zwraca liczbę sekcji pominiętych w chwili pomiaru.
 */
async function measureSkippedSections(page: Page): Promise<number> {
  return page.evaluate(() => {
    const measure = () => {
      for (const el of document.querySelectorAll<HTMLElement>("main [data-cv] *")) {
        void el.scrollTop;
      }
    };
    let skipped = 0;
    for (const wrapper of document.querySelectorAll<HTMLElement>("main [data-cv]")) {
      const row = wrapper.querySelector("[data-columns-row]");
      if (row && !row.checkVisibility({ contentVisibilityAuto: true })) skipped += 1;
    }
    measure();
    addEventListener("popstate", measure);
    return skipped;
  });
}

/**
 * Śledzenie celu po każdej klatce (odczyt PO klatce: rAF -> `setTimeout(0)`, więc nie
 * wymusza układu przed klatką) od pierwszego `popstate` po `start` - nawigacja do fragmentu
 * i wstecz/dalej zaczynają się od niego, a przeglądarka przewija dopiero po jego nasłuchach.
 * Notuje też pierwszy `onRendered` routera po nawigacji: TanStack obsługuje każdą zmianę `#`
 * pełnym `router.load` i renderem, a po nim przewija do celu (`scrollIntoView`) - pod
 * dławieniem x6 nawet kilka sekund po skoku.
 */
async function installTargetTracker(page: Page): Promise<void> {
  await page.evaluate(() => {
    let state: {
      id: string;
      navAt: number | null;
      renderedAfter: number | null;
      samples: TargetSample[];
      on: boolean;
    } | null = null;
    addEventListener("popstate", () => {
      if (state && state.navAt === null) state.navAt = performance.now();
    });
    (
      window as unknown as {
        __TSR_ROUTER__: { subscribe: (event: "onRendered", listener: () => void) => unknown };
      }
    ).__TSR_ROUTER__.subscribe("onRendered", () => {
      if (state && state.navAt !== null && state.renderedAfter === null) {
        state.renderedAfter = Math.round(performance.now() - state.navAt);
      }
    });
    const sample = () => {
      const el = state?.on && state.navAt !== null ? document.getElementById(state.id) : null;
      if (!state || !el) return;
      const header = document.querySelector("[data-site-header]")?.getBoundingClientRect();
      state.samples.push({
        t: Math.round(performance.now() - state.navAt!),
        top: Math.round(el.getBoundingClientRect().top * 10) / 10,
        hb: Math.round(Math.max(0, header?.bottom ?? 0) * 10) / 10,
        y: Math.round(scrollY),
      });
    };
    const frame = () => {
      if (!state?.on) return;
      setTimeout(sample, 0);
      requestAnimationFrame(frame);
    };
    window.__cvTrack = {
      start(id) {
        state = { id, navAt: null, renderedAfter: null, samples: [], on: true };
        requestAnimationFrame(frame);
      },
      rendered: () => state?.renderedAfter != null,
      stop() {
        const done = state!;
        state = null;
        return { navAt: done.navAt, renderedAfter: done.renderedAfter, samples: done.samples };
      },
    };
  });
}

/**
 * Spoczynek po nawigacji do fragmentu: najpierw render routera po niej (jego `scrollIntoView`
 * przychodzi pod dławieniem z opóźnieniem i inaczej wpadłby w kolejny krok testu), potem
 * stabilny `scrollY` i nagłówek.
 */
async function settleAfterNavigation(page: Page, maxPolls: number): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__cvTrack!.rendered()), { timeout: 60_000 })
    .toBe(true);
  await settle(page, maxPolls);
}

/** Cel stoi tuż pod nagłówkiem: nie schowany pod nim, nie w dole ekranu. */
const onTarget = (top: number, headerBottom: number, viewportHeight: number) =>
  top >= headerBottom - 1 && top < headerBottom + viewportHeight / 3;

/**
 * Cel stoi pod nagłówkiem w każdej klatce aż do spoczynku - żadnego „złej sekcji, a potem
 * skoku". Nawigację do fragmentu (`location.hash`, link) przeglądarka przewija synchronicznie,
 * więc liczy się już pierwsza klatka po niej (`fromFirstFrame`). Wstecz/dalej przewija router
 * dopiero po renderze - liczy się każda klatka od pierwszej, w której cel stanął na miejscu.
 */
function expectStaysOnTarget(
  track: TargetTrack,
  viewportHeight: number,
  label: string,
  fromFirstFrame: boolean,
): void {
  expect(track.navAt, `${label}: brak nawigacji (popstate)`).not.toBeNull();
  expect(track.samples.length, `${label}: brak klatek po nawigacji`).toBeGreaterThan(0);
  const ok = (s: TargetSample) => onTarget(s.top, s.hb, viewportHeight);
  const first = fromFirstFrame ? 0 : track.samples.findIndex(ok);
  expect(
    first,
    `${label}: cel ani razu nie stanął pod nagłówkiem: ${JSON.stringify(track.samples.slice(-6))}`,
  ).toBeGreaterThanOrEqual(0);
  const off = track.samples.slice(first).filter((s) => !ok(s));
  expect(
    off.slice(0, 6),
    `${label}: cel poza miejscem pod nagłówkiem w ${off.length} z ${track.samples.length - first} klatek od ${track.samples[first].t} ms po nawigacji (render routera: ${track.renderedAfter} ms)`,
  ).toEqual([]);
}

/** Stan po spoczynku: położenie celu, nagłówek, `scrollY`, wyłącznik i cv sekcji celu. */
const where = (id: string) => {
  const el = document.getElementById(id)!;
  const header = document.querySelector("[data-site-header]")?.getBoundingClientRect();
  return {
    top: el.getBoundingClientRect().top,
    headerBottom: Math.max(0, header?.bottom ?? 0),
    scrollY,
    cvOff: document.documentElement.hasAttribute("data-cv-off"),
    sectionCv: getComputedStyle(el.closest("[data-cv]")!).contentVisibility,
  };
};

/**
 * Po spoczynku cel stoi tuż pod nagłówkiem, a strona jest przewinięta co najmniej o `minScrollY`
 * (domyślnie ekran: cel leżał daleko pod zgięciem).
 */
function expectLanded(
  landed: ReturnType<typeof where>,
  viewportHeight: number,
  minScrollY = viewportHeight,
): void {
  expect(landed.scrollY, JSON.stringify(landed)).toBeGreaterThan(minScrollY);
  expect(onTarget(landed.top, landed.headerBottom, viewportHeight), JSON.stringify(landed)).toBe(
    true,
  );
}

/** Link `#id` w rogu widoku (`position: fixed`), w który test klika jak użytkownik. */
async function anchorLink(page: Page, id: string): Promise<void> {
  await page.evaluate((target) => {
    let a = document.getElementById("e2e-kotwica") as HTMLAnchorElement | null;
    if (!a) {
      a = document.createElement("a");
      a.id = "e2e-kotwica";
      a.textContent = "Przejdź do celu";
      a.setAttribute(
        "style",
        "position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:14px;background:#ff0;color:#000;font:16px sans-serif",
      );
      document.body.append(a);
    }
    a.href = `#${target}`;
  }, id);
}

for (const { name, viewport } of VIEWPORTS) {
  test.describe(`content-visibility sekcji, ${name} ${viewport.width}x${viewport.height} (P3.3)`, () => {
    // Lokalizacja przeglądarki = język strony: powrót do `/` w SPA negocjuje język po stronie
    // klienta, a domyślne `en-US` Playwrighta przekierowałoby na `/en`.
    test.use({ viewport, locale: "pl-PL" });

    test("HTML serwera: cv od trzeciej sekcji, sekcje w widoku wyrenderowane w pierwszej klatce", async ({
      page,
    }) => {
      await openHome(page);
      const sections = await contentSections(page);

      expect(sections.length).toBeGreaterThanOrEqual(5);
      expect(sections.slice(0, 2).map((s) => s.cv)).toEqual([null, null]);
      const withCv = sections.filter((s) => s.cv !== null);
      expect(withCv.length).toBeGreaterThanOrEqual(3);
      for (const s of withCv) expect(s.contentVisibility).toBe("auto");
      // Sekcja choćby częściowo w widoku jest zawsze wyrenderowana (bez pustego pasa).
      for (const s of sections.filter((s) => s.top < viewport.height && s.top + s.height > 0)) {
        expect(s.rendered, `sekcja ${s.id} w widoku`).toBe(true);
      }
      if (viewport.width < 768) {
        // Na telefonie sekcje daleko pod zgięciem są naprawdę pominięte.
        expect(withCv.some((s) => !s.rendered)).toBe(true);
      }
    });

    test("przewinięcie kółkiem do końca strony: zero przesunięć układu w obszarze cv", async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await observeShifts(page);
      await openHome(page);
      await page.waitForTimeout(1_000);
      const atLoad = await shifts(page);
      if (atLoad.length > 0) {
        // Przesunięcia przy wczytaniu przed obszarem cv (nagłówek, sekcja 0) zdarzają się też
        // na bazie fali bez P3.3 - odnotowujemy je, ale nie są przedmiotem tego testu.
        test.info().annotations.push({ type: "load-shifts", description: JSON.stringify(atLoad) });
      }
      expect(atLoad.filter((entry) => entry.cvRegion)).toEqual([]);

      // Pierwsze przewinięcie kurczy nagłówek (`sticky-shrink`); czekamy, aż stanie.
      await wheel(page, 240, 1);
      await page.waitForTimeout(1_500);
      const headerPhase = (await shifts(page)).length;

      await scrollToBottom(page);

      const all = await shifts(page);
      expect(all.slice(headerPhase)).toEqual([]);
      expect(all.filter((entry) => entry.cvRegion)).toEqual([]);
      await expect(page.locator("footer[data-site-footer]")).toBeInViewport();
    });

    // KOTWICA PO WCZYTANIU NA WOLNYM TELEFONIE (scenariusz 3). Każdy przypadek na świeżej
    // stronie z cv włączonym: pierwsza nawigacja do fragmentu w obszarze cv jest tą, o którą
    // chodzi (strażnik wyłącza cv raz, na resztę życia dokumentu).
    const cpuRate = viewport.width < 768 ? PHONE_CPU_THROTTLE : 1;
    const ANCHOR_TIMEOUT = cpuRate > 1 ? 120_000 : 60_000;
    const settlePolls = cpuRate > 1 ? 150 : 60;

    async function openForAnchor(page: Page): Promise<AnchorTargets> {
      await throttleCpu(page, cpuRate);
      await openHome(page);
      const targets = await anchorTargets(page);
      const skipped = await measureSkippedSections(page);
      if (viewport.width < 768) {
        // Na telefonie sekcje nad celem są przy skoku naprawdę pominięte (pasy z szacunku).
        expect(skipped).toBeGreaterThanOrEqual(2);
      }
      await installTargetTracker(page);
      return targets;
    }

    for (const mode of ["location.hash", "klik w link #id"] as const) {
      for (const which of ["far", "sectionTop"] as const) {
        const label = which === "far" ? "nagłówek w dalszej sekcji" : "góra dalszej sekcji";
        test(`kotwica po wczytaniu (${mode}, ${label}, CPU x${cpuRate}): cel staje pod nagłówkiem i już nie ucieka`, async ({
          page,
        }) => {
          test.setTimeout(ANCHOR_TIMEOUT);
          const targets = await openForAnchor(page);
          const id = targets[which];

          if (mode === "location.hash") {
            await page.evaluate((target) => {
              window.__cvTrack!.start(target);
              location.hash = target;
            }, id);
          } else {
            await anchorLink(page, id);
            await page.evaluate((target) => window.__cvTrack!.start(target), id);
            await page.locator("#e2e-kotwica").click();
          }
          await settleAfterNavigation(page, settlePolls);
          const track = await page.evaluate(() => window.__cvTrack!.stop());
          expectStaysOnTarget(track, viewport.height, `${mode} -> #${id}`, true);
          const landed = await page.evaluate(where, id);
          expectLanded(landed, viewport.height);

          if (mode === "location.hash" && which === "far") {
            // Przewinięcie kółkiem w górę przesuwa cel w widoku dokładnie o obrót kółka: nic
            // nad celem nie dorysowuje się już z pasa z szacunku (skok pasa to dziesiątki-setki
            // pikseli).
            const WHEEL_UP = 300;
            await wheel(page, -WHEEL_UP, 1);
            await settle(page, settlePolls);
            const up = await page.evaluate(where, id);
            expect(
              Math.abs(up.top - landed.top - WHEEL_UP),
              JSON.stringify({ landed, up }),
            ).toBeLessThanOrEqual(2);
          }
        });
      }
    }

    test(`kotwica: wstecz/dalej między fragmentami (CPU x${cpuRate}) - każdy cel wraca pod nagłówek, a powrót sprzed pierwszej kotwicy - do miejsca czytania`, async ({
      page,
    }) => {
      test.setTimeout(ANCHOR_TIMEOUT);
      const targets = await openForAnchor(page);
      const step = async (
        id: string,
        go: () => Promise<unknown>,
        label: string,
        fromFirstFrame: boolean,
      ) => {
        await page.evaluate((target) => window.__cvTrack!.start(target), id);
        await go();
        await settleAfterNavigation(page, settlePolls);
        const track = await page.evaluate(() => window.__cvTrack!.stop());
        expectStaysOnTarget(track, viewport.height, label, fromFirstFrame);
        // Druga sekcja z cv stoi na desktopie niecały ekran pod górą strony (zmierzone: 485 px).
        const minScrollY = id === targets.earlier ? 0 : viewport.height;
        expectLanded(await page.evaluate(where, id), viewport.height, minScrollY);
      };

      // Czytelnik jest już kawałek niżej: router zapisze tę pozycję w `popstate` pierwszej
      // nawigacji do fragmentu (wpis, z którego się wychodzi) - strażnik nie może przewinąć
      // przed tym zapisem.
      await wheel(page, 400, 1);
      await settle(page, settlePolls);
      const reading = await page.evaluate(() => scrollY);
      expect(reading).toBeGreaterThan(0);

      await step(
        targets.earlier,
        () =>
          page.evaluate((target) => {
            location.hash = target;
          }, targets.earlier),
        "location.hash #wcześniejsza",
        true,
      );
      await anchorLink(page, targets.sectionTop);
      await step(
        targets.sectionTop,
        () => page.locator("#e2e-kotwica").click(),
        "klik #dalsza",
        true,
      );
      await step(targets.earlier, () => page.goBack(), "wstecz", false);
      await step(targets.sectionTop, () => page.goForward(), "dalej", false);

      // Dwa wpisy wstecz: dokument sprzed pierwszej kotwicy, router przywraca miejsce czytania.
      await page.evaluate((target) => window.__cvTrack!.start(target), targets.earlier);
      await page.evaluate(() => history.go(-2));
      await settleAfterNavigation(page, settlePolls);
      await page.evaluate(() => window.__cvTrack!.stop());
      const back = await page.evaluate(() => ({ y: scrollY, hash: location.hash }));
      expect(back.hash).toBe("");
      expect(Math.abs(back.y - reading), JSON.stringify({ reading, back })).toBeLessThanOrEqual(2);
    });

    test(`kotwica przy wejściu z fragmentem w adresie (CPU x${cpuRate}): strażnik zdejmuje cv przed parsowaniem sekcji`, async ({
      page,
      context,
    }) => {
      test.setTimeout(ANCHOR_TIMEOUT);
      await throttleCpu(page, cpuRate);
      await openHome(page);
      const { far } = await anchorTargets(page);

      // Strażnik zdejmuje cv przed parsowaniem sekcji, więc skrypt kotwicy TanStacka
      // i przeglądarka liczą na prawdziwym układzie (jak bez P3.3).
      const deep = await context.newPage();
      await throttleCpu(deep, cpuRate);
      await openHome(deep, `/#${encodeURIComponent(far)}`);
      await settle(deep, settlePolls);
      const entered = await deep.evaluate(where, far);
      expect(entered.cvOff).toBe(true);
      expect(entered.sectionCv).toBe("visible");
      expectLanded(entered, viewport.height);
    });

    test("przeładowanie w połowie strony: strażnik zdejmuje cv, przywrócenie trafia w ten sam punkt", async ({
      page,
    }) => {
      await openHome(page);
      // Głęboko w stronę, przez sekcje z cv (dorysowują się po drodze).
      await wheel(page, 400, 8, 80);
      await page.waitForTimeout(600);
      const at = (id: string | null) => {
        const sections = [...document.querySelectorAll<HTMLElement>("main [data-sec-id]")];
        const anchor = id
          ? document.querySelector<HTMLElement>(`main [data-sec-id="${id}"]`)!
          : sections.find((s) => s.getBoundingClientRect().bottom > 0)!;
        return {
          id: anchor.getAttribute("data-sec-id"),
          top: anchor.getBoundingClientRect().top,
          y: scrollY,
          cvOff: document.documentElement.hasAttribute("data-cv-off"),
        };
      };
      const before = await page.evaluate(at, null);
      expect(before.y).toBeGreaterThan(1_000);

      // Skrypt TanStacka zapisuje pozycję przy `pagehide` i przywraca ją na końcu `<main>`.
      await page.reload();
      await expect.poll(() => page.evaluate(() => window.__nesAppReady === true)).toBe(true);
      await page.waitForTimeout(1_000);
      const after = await page.evaluate(at, before.id);
      expect(after.cvOff).toBe(true);
      // Baza fali bez P3.3: desktop co do piksela, telefon 26 px (nagłówek zmienia stan po
      // przywróceniu). Pasy z szacunku bez strażnika dawały setki pikseli.
      expect(
        Math.abs(after.top - before.top),
        JSON.stringify({ before, after }),
      ).toBeLessThanOrEqual(40);
    });

    test("powrót „wstecz” po nawigacji SPA: strona główna renderuje się po stronie klienta, bez cv", async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await openHome(page);
      await wheel(page, 400, 8, 80);
      await page.waitForTimeout(600);
      const before = await page.evaluate(() => {
        const sections = [
          ...document.querySelectorAll("main [data-builder-renderer] [data-sec-id]"),
        ];
        for (const section of sections) section.setAttribute("data-e2e-server-node", "");
        return {
          y: scrollY,
          sections: sections.length,
          cvSections: document.querySelectorAll("main [data-cv]").length,
        };
      });
      expect(before.cvSections).toBeGreaterThanOrEqual(3);

      // Nawigacja routera (jak klik w link) na stronę bez danych z bazy w przeglądarce:
      // na fixture link do wpisu nie kończy nawigacji (wpis czeka na backend), więc strona
      // główna nie odmontowałaby się wcale.
      await page.evaluate(() =>
        (
          window as unknown as {
            __TSR_ROUTER__: { navigate: (options: { to: string }) => Promise<void> };
          }
        ).__TSR_ROUTER__.navigate({ to: "/regulamin" }),
      );
      await page.waitForURL(/\/regulamin$/);
      await expect
        .poll(() => page.evaluate(() => document.querySelectorAll("[data-e2e-server-node]").length))
        .toBe(0);
      await page.goBack();
      await page.waitForURL((url) => url.pathname === "/");
      await expect
        .poll(() =>
          page.evaluate(
            () => document.querySelectorAll("main [data-builder-renderer] [data-sec-id]").length,
          ),
        )
        .toBe(before.sections);
      await page.waitForTimeout(800);

      const after = await page.evaluate(() => ({
        y: scrollY,
        cvSections: document.querySelectorAll("main [data-cv]").length,
        autoSections: [...document.querySelectorAll<HTMLElement>("main [data-sec-id]")].filter(
          (el) => getComputedStyle(el.closest("[data-cv]") ?? el).contentVisibility === "auto",
        ).length,
      }));
      // Render kliencki (bez nośnika `data-lcp-root`): żadna sekcja nie ma cv, więc
      // przywrócenie przewinięcia routera liczy na prawdziwym układzie, dokładnie jak
      // bez P3.3.
      expect(after.cvSections).toBe(0);
      expect(after.autoSections).toBe(0);
      test.info().annotations.push({
        type: "scroll-restoration",
        description: `przed ${before.y}, po powrocie ${after.y}`,
      });
    });
  });
}

test("druk: reguła `@media print` zdejmuje content-visibility z sekcji", async ({ page }) => {
  await openHome(page);
  const screen = await contentSections(page);
  expect(screen.filter((s) => s.cv !== null).every((s) => s.contentVisibility === "auto")).toBe(
    true,
  );

  await page.emulateMedia({ media: "print" });
  const print = await contentSections(page);
  const withCv = print.filter((s) => s.cv !== null);
  expect(withCv.length).toBeGreaterThanOrEqual(3);
  for (const s of withCv) expect(s.contentVisibility).toBe("visible");
});
