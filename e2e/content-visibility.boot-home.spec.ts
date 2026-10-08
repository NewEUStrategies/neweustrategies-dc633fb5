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
//  3. Kotwica `#id` w dalszej sekcji: po wczytaniu (cv włączone, nawigacja do fragmentu
//     aktywuje pominiętą sekcję celu) cel stoi tuż pod nagłówkiem, a dorysowanie sekcji nad
//     nim przy przewinięciu w górę nie rusza celu (zakotwiczenie przewijania); przy wejściu
//     z fragmentem w adresie strażnik bloku cv (`html[data-cv-off]`) zdejmuje cv przed
//     parsowaniem sekcji i strona zachowuje się jak bez P3.3.
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

declare global {
  interface Window {
    __nesAppReady?: boolean;
    __cvShifts?: ShiftEntry[];
  }
}

const VIEWPORTS = [
  { name: "telefon", viewport: { width: 412, height: 823 } },
  { name: "desktop", viewport: { width: 1350, height: 940 } },
] as const;

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
 * `scrollY` jeszcze ~1,1 s (zmierzone) - pomiar w trakcie widzi pozycję pośrednią.
 */
async function settle(page: Page): Promise<void> {
  let last = "";
  for (let polls = 0, stable = 0; polls < 60 && stable < 5; polls += 1) {
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

    test("kotwica #id w dalszej sekcji trafia w cel: po wczytaniu (cv włączone) i przy wejściu z fragmentem (strażnik)", async ({
      page,
      context,
    }) => {
      await openHome(page);
      // Cel: element z `id` w najdalszej sekcji treści od indeksu 2 (na fixture: nagłówek
      // formularza „Dołącz"), za sekcjami z cv.
      const target = await page.evaluate(() => {
        const root = document.querySelector("main [data-lcp-root]");
        const sections = [...(root?.querySelectorAll<HTMLElement>("[data-sec-id]") ?? [])];
        for (let i = sections.length - 1; i >= 2; i -= 1) {
          const el = sections[i].querySelector("[id]");
          if (el) {
            return {
              id: el.id,
              sectionCv: !!sections[i].closest("[data-cv]"),
              cvBefore: sections.slice(0, i).filter((s) => s.closest("[data-cv]")).length,
            };
          }
        }
        return null;
      });
      expect(target).not.toBeNull();
      expect(target!.sectionCv).toBe(true);
      expect(target!.cvBefore).toBeGreaterThanOrEqual(2);

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
      const expectLanded = (landed: ReturnType<typeof where>) => {
        expect(landed.scrollY).toBeGreaterThan(viewport.height);
        // Cel widoczny tuż pod nagłówkiem (nie schowany pod nim, nie w dole ekranu).
        expect(landed.top).toBeGreaterThanOrEqual(landed.headerBottom - 1);
        expect(landed.top).toBeLessThan(landed.headerBottom + viewport.height / 3);
      };

      // 1. Po wczytaniu, przy włączonym cv: nawigacja do fragmentu aktywuje pominiętą sekcję
      //    celu, choć sekcje nad nim stoją na pasach z szacunku.
      await page.evaluate((id) => {
        location.hash = id;
      }, target!.id);
      await settle(page);
      const inPage = await page.evaluate(where, target!.id);
      expect(inPage.cvOff).toBe(false);
      expect(inPage.sectionCv).toBe("auto");
      expectLanded(inPage);
      // Przewinięcie kółkiem w górę dorysowuje sekcje nad celem, a cel przesuwa się w widoku
      // dokładnie o obrót kółka (zmierzone 12/12: 300,0 px): sekcje tuż nad widokiem są już
      // wyrenderowane z bliskości, a zmianę wysokości dalszych pochłania zakotwiczenie
      // przewijania (korekta `scrollY`). Skok pasa z szacunku to dziesiątki-setki pikseli.
      const WHEEL_UP = 300;
      await wheel(page, -WHEEL_UP, 1);
      await settle(page);
      const up = await page.evaluate(where, target!.id);
      expect(
        Math.abs(up.top - inPage.top - WHEEL_UP),
        JSON.stringify({ inPage, up }),
      ).toBeLessThanOrEqual(2);

      // 2. Wejście z fragmentem w adresie: strażnik zdejmuje cv przed parsowaniem sekcji, więc
      //    skrypt kotwicy TanStacka i przeglądarka liczą na prawdziwym układzie (jak bez P3.3).
      const deep = await context.newPage();
      await openHome(deep, `/#${encodeURIComponent(target!.id)}`);
      await settle(deep);
      const entered = await deep.evaluate(where, target!.id);
      expect(entered.cvOff).toBe(true);
      expect(entered.sectionCv).toBe("visible");
      expectLanded(entered);
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
