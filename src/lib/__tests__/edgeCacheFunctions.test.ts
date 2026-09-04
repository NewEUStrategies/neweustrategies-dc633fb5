// Funkcje serwerowe karty "NES Edge Cache" (/admin/performance?tab=cache):
// odczyt statystyk, czyszczenie i sonda pojedynczej ścieżki.
//
// PO CO TEN PLIK ISTNIEJE. Do 04.09.2026 `src/lib/edgeCache.functions.ts` miał
// 0,00% pokrycia (0/10 linii, 0/2 gałęzi, 0/5 funkcji) - był importowany
// wyłącznie przez `EdgeCacheCard.tsx`, a test tej karty podmienia CAŁY moduł
// atrapą. Panel był więc przetestowany, a warstwa serwerowa pod nim nie
// wykonała się w testach ani razu. Trzy rzeczy, które ten plik przybija, są
// niewidoczne z poziomu UI:
//   1. BRAMKA. Snapshot cache'a ujawnia ostatnie decyzje razem ze ścieżkami
//      dokumentów (kto co czytał), a czyszczenie zdejmuje wszystkim
//      czytelnikom gotowe dokumenty i wraca do pełnego renderu SSR - to
//      kosztowna operacja, nie „odśwież". Bez roli staff jedno i drugie stoi
//      otworem.
//   2. ZAWĘŻENIE DO HOSTA. Czyszczenie idzie przez
//      `purgeDocumentCacheForCurrentHost()`, nie przez globalny
//      `purgeDocumentCache()`. Pomyłka w tym miejscu daje adminowi jednego
//      tenanta prawo zrzucenia cache'a WSZYSTKICH tenantów (doktryna
//      tenant_id) - i nie widać jej ani w UI, ani w typach.
//   3. WALIDATOR SONDY. `probeEdgeCache` przyjmuje ścieżkę od użytkownika.
//      Gdyby przepuszczała adres absolutny albo protokołowo-względny
//      (`//obcy.host`), sonda stałaby się narzędziem do odpytywania obcych
//      hostów z serwera - klasyczne SSRF przez pole tekstowe w panelu.
//
// CZEGO TEN PLIK NIE DOWODZI: DZIAŁANIA BRAMKI. Harness `serverFnStubModule`
// celowo NIE uruchamia middleware, więc zieleń poniżej mówi o handlerach,
// a nie o tym, kogo `requireStaff` wpuszcza. Deklaracja bramki jest przybita
// STRUKTURALNIE (`serverFnMiddlewareNames`), a jej CIAŁO - każda ścieżka
// odmowy, rola i wymuszenie MFA - ma własny, świeży plik z pełnym pokryciem
// gałęzi: `src/integrations/supabase/__tests__/requireStaff.test.ts`.
// Dublowanie go tutaj nie dodałoby dowodu, a atrapa nazw pozwala odróżnić
// bramkę staff od trzech pozostałych (admin, admin/editor, CRM).
//
// MODUŁ POKRYWANY NIE JEST ATRAPOWANY: `@/lib/edgeCache.functions` jest
// importowany prawdziwy. Podmienione są tylko granice - fabryka frameworka,
// bramka autoryzacji i MAGAZYN dokumentów (`documentCache.server`, warstwa
// stanu procesu z własnymi testami). Po argumentach magazynu poznajemy, co
// handler naprawdę zrobił.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getDocumentCacheSnapshot: vi.fn(),
  probeDocumentCache: vi.fn(),
  purgeDocumentCacheForCurrentHost: vi.fn<() => Promise<number>>(),
  /** Globalne czyszczenie - tu WYŁĄCZNIE jako dowód, że nikt go nie woła. */
  purgeDocumentCache: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
// Cztery bramki z `require-staff.ts` z ROZRÓŻNIALNYMI nazwami: asercja
// `toEqual(["requireStaff"])` pada zarówno po usunięciu bramki, jak i po
// podmianie jej na inną. Ciało middleware jest dowodzone w requireStaff.test.ts.
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireStaff: { name: "requireStaff" },
  requireAdmin: { name: "requireAdmin" },
  requireAdminEditor: { name: "requireAdminEditor" },
  requireCrmStaff: { name: "requireCrmStaff" },
}));
vi.mock("@/lib/http/documentCache.server", () => ({
  getDocumentCacheSnapshot: h.getDocumentCacheSnapshot,
  probeDocumentCache: h.probeDocumentCache,
  purgeDocumentCacheForCurrentHost: h.purgeDocumentCacheForCurrentHost,
  purgeDocumentCache: h.purgeDocumentCache,
}));

import {
  asServerFn,
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
  type ServerFnContext,
} from "@/test/serverFnHarness";
import {
  getEdgeCacheStats,
  probeEdgeCache,
  purgeEdgeCache,
  type DocumentCacheProbe,
  type DocumentCacheSnapshot,
  type EdgeCachePurgeResult,
} from "@/lib/edgeCache.functions";

// --- dane syntetyczne -------------------------------------------------------

/**
 * Kontekst wstrzykiwany przez middleware. Te trzy handlery czytają stan
 * z PAMIĘCI PROCESU, nie z bazy, więc klient jest tu wyłącznie kształtem -
 * gdyby któryś handler zaczął go używać, atrapa natychmiast to pokaże.
 */
const KONTEKST: ServerFnContext = { supabase: {} };

function snapshot(overrides: Partial<DocumentCacheSnapshot> = {}): DocumentCacheSnapshot {
  return {
    name: "nes-doc-cache-test",
    enabled: true,
    entries: 12,
    bytes: 4096,
    maxBytes: 1048576,
    hits: 40,
    stale: 2,
    misses: 5,
    bypass: 1,
    stores: 7,
    evictions: 0,
    purges: 0,
    oversize: 0,
    revalidations: 1,
    revalidationFailures: 0,
    startedAt: "2026-09-04T09:00:00.000Z",
    l2: { enabled: false, hits: 0, stale: 0, stores: 0, bumps: 0 },
    recent: [],
    ...overrides,
  };
}

function sonda(overrides: Partial<DocumentCacheProbe> = {}): DocumentCacheProbe {
  return {
    path: "/blog/wpis-testowy",
    key: "nes.example.com|/blog/wpis-testowy",
    cacheable: true,
    cached: true,
    status: "HIT",
    ageS: 12,
    freshForS: 168,
    bytes: 2048,
    cacheControl: "public, max-age=0, s-maxage=180",
    ...overrides,
  };
}

/** Ścieżka o zadanej długości - do testów granicy `max(512)`. */
function sciezkaDlugosci(n: number): string {
  return `/${"a".repeat(n - 1)}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getDocumentCacheSnapshot.mockReturnValue(snapshot());
  h.purgeDocumentCacheForCurrentHost.mockResolvedValue(0);
  h.probeDocumentCache.mockResolvedValue(sonda());
});

describe("obudowa - kto może zaglądać w cache i go czyścić", () => {
  it("wszystkie trzy operacje stoją za bramką staff", () => {
    // Dowód STRUKTURALNY (harness nie uruchamia middleware). Gdyby bramka
    // zniknęła z którejkolwiek pozycji, anonim odczytałby ostatnie decyzje
    // cache'a ze ścieżkami dokumentów albo zrzucił cały cache jednym POST-em.
    const funkcje: Array<[string, unknown]> = [
      ["getEdgeCacheStats", getEdgeCacheStats],
      ["purgeEdgeCache", purgeEdgeCache],
      ["probeEdgeCache", probeEdgeCache],
    ];

    for (const [nazwa, fn] of funkcje) {
      expect(serverFnMiddlewareNames(fn), `${nazwa} bez bramki`).toEqual(["requireStaff"]);
    }
  });

  it("czyszczenie i sonda są POST-ami, odczyt statystyk GET-em", () => {
    // Metoda nie jest tu kosmetyką. Czyszczenie pod GET-em odpaliłby dowolny
    // prefetch linku, podglądacz w komunikatorze albo crawler - a każde takie
    // wejście zdejmuje wszystkim czytelnikom gotowe dokumenty i zawraca ruch
    // do pełnego renderu SSR.
    expect(asServerFn(getEdgeCacheStats).method).toBe("GET");
    expect(asServerFn(purgeEdgeCache).method).toBe("POST");
    expect(asServerFn(probeEdgeCache).method).toBe("POST");
  });
});

describe("getEdgeCacheStats - odczyt bez skutków ubocznych", () => {
  it("oddaje snapshot magazynu bez przerabiania", async () => {
    // Karta pokazuje liczniki 1:1. Gdyby handler cokolwiek tu przeliczał,
    // diagnoza wydajności opierałaby się na danych z drugiej ręki - dlatego
    // dowodem jest TOŻSAMOŚĆ obiektu, nie zgodność pól.
    const oczekiwany = snapshot({ entries: 33, hits: 900 });
    h.getDocumentCacheSnapshot.mockReturnValue(oczekiwany);

    const wynik = await callServerFn<DocumentCacheSnapshot>(getEdgeCacheStats, {
      context: KONTEKST,
    });

    expect(wynik).toBe(oczekiwany);
    expect(h.getDocumentCacheSnapshot).toHaveBeenCalledTimes(1);
  });

  it("nie czyści niczego przy okazji odczytu", async () => {
    // Wejście na kartę diagnostyczną nie ma prawa zmieniać stanu cache'a -
    // inaczej samo patrzenie na metryki psułoby wydajność, którą mierzą.
    await callServerFn(getEdgeCacheStats, { context: KONTEKST });

    expect(h.purgeDocumentCacheForCurrentHost).not.toHaveBeenCalled();
    expect(h.purgeDocumentCache).not.toHaveBeenCalled();
    expect(h.probeDocumentCache).not.toHaveBeenCalled();
  });
});

describe("purgeEdgeCache - czyszczenie zawężone do tenanta", () => {
  it("czyści WYŁĄCZNIE hosta bieżącego żądania, nigdy globalnie", async () => {
    // Sedno doktryny tenant_id na tej karcie: admin tenanta A nie może zrzucić
    // cache'a tenanta B. Globalna wersja funkcji jest w tym samym module i
    // różni się jednym słowem w nazwie, więc pomyłka jest realna, a jej skutek
    // - cudzy serwis liczący od nowa każdy dokument - niewidoczny u sprawcy.
    await callServerFn(purgeEdgeCache, { context: KONTEKST });

    expect(h.purgeDocumentCacheForCurrentHost).toHaveBeenCalledTimes(1);
    expect(h.purgeDocumentCacheForCurrentHost).toHaveBeenCalledWith();
    expect(h.purgeDocumentCache).not.toHaveBeenCalled();
  });

  it("zwraca snapshot POBRANY PO czyszczeniu, nie sprzed", async () => {
    // Kolejność jest treścią: karta odświeża liczniki tym snapshotem. Gdyby
    // handler pobrał go przed czyszczeniem, admin zobaczyłby stan sprzed
    // operacji i uznałby, że czyszczenie nie działa (a potem klikał je
    // wielokrotnie). Atrapa magazynu ODDAJE RÓŻNE liczby przed i po, więc
    // odwrócenie kolejności w kodzie wywraca ten test.
    let wyczyszczone = false;
    h.purgeDocumentCacheForCurrentHost.mockImplementation(async () => {
      wyczyszczone = true;
      return 7;
    });
    h.getDocumentCacheSnapshot.mockImplementation(() =>
      snapshot(wyczyszczone ? { entries: 0, purges: 1 } : { entries: 12, purges: 0 }),
    );

    const wynik = await callServerFn<EdgeCachePurgeResult>(purgeEdgeCache, { context: KONTEKST });

    expect(wynik.removed).toBe(7);
    expect(wynik.snapshot.entries).toBe(0);
    expect(wynik.snapshot.purges).toBe(1);
  });

  it("zero usuniętych dokumentów wraca jako 0, nie jako brak wartości", async () => {
    // „Nic nie było do wyczyszczenia" to poprawna odpowiedź i karta ma ją
    // pokazać jako 0. Skrót typu `removed || null` zamieniłby ją w puste
    // miejsce w UI, czyli w komunikat „operacja się nie udała".
    h.purgeDocumentCacheForCurrentHost.mockResolvedValue(0);

    const wynik = await callServerFn<EdgeCachePurgeResult>(purgeEdgeCache, { context: KONTEKST });

    expect(wynik.removed).toBe(0);
    expect(Object.keys(wynik).sort()).toEqual(["removed", "snapshot"]);
  });
});

describe("probeEdgeCache - walidator ścieżki (bramka SSRF)", () => {
  it("ścieżka względna dochodzi do magazynu, a wynik sondy wraca bez zmian", async () => {
    const oczekiwana = sonda({ path: "/blog/wpis-testowy", status: "STALE" });
    h.probeDocumentCache.mockResolvedValue(oczekiwana);

    const wynik = await callServerFn<DocumentCacheProbe>(probeEdgeCache, {
      data: { path: "/blog/wpis-testowy" },
      context: KONTEKST,
    });

    expect(h.probeDocumentCache).toHaveBeenCalledWith("/blog/wpis-testowy");
    expect(wynik).toBe(oczekiwana);
  });

  it("przycina białe znaki, bo do pola panelu wkleja się ścieżkę z kopiowania", async () => {
    // `trim()` stoi PRZED sprawdzeniem początku ścieżki, więc wklejone
    // " /blog/wpis " nadal jest ścieżką względną, a nie odrzuconym wejściem.
    const dane = validateServerFnInput<{ path: string }>(probeEdgeCache, {
      path: "  /blog/wpis-testowy  ",
    });

    expect(dane.path).toBe("/blog/wpis-testowy");
  });

  it("sama strona główna `/` jest poprawną ścieżką", () => {
    // Granica reguły: `/` spełnia warunek „zaczyna się od /" i nie jest
    // protokołowo-względne. To najczęściej sondowany dokument w serwisie.
    expect(validateServerFnInput<{ path: string }>(probeEdgeCache, { path: "/" }).path).toBe("/");
  });

  it("odrzuca adres ABSOLUTNY - sonda nie odpytuje obcych hostów", async () => {
    // Lewa strona warunku `startsWith("/")`. Bez niej pole tekstowe w panelu
    // byłoby proxy do dowolnego adresu, wykonywanym przez serwer aplikacji
    // (SSRF, w tym adresy z sieci wewnętrznej).
    await expect(
      callServerFn(probeEdgeCache, {
        data: { path: "https://obcy.example.com/sekret" },
        context: KONTEKST,
      }),
    ).rejects.toThrow(/path must be a site-relative path/);

    // Dowód, że walidator jest BRAMKĄ: magazyn nie został dotknięty.
    expect(h.probeDocumentCache).not.toHaveBeenCalled();
  });

  it("odrzuca ścieżkę PROTOKOŁOWO-WZGLĘDNĄ `//obcy.host`", async () => {
    // Prawa strona warunku `!startsWith("//")` - dokładnie ten przypadek
    // przechodzi obok naiwnego sprawdzenia „zaczyna się od ukośnika",
    // a przeglądarka i `new URL()` czytają go jako OBCY HOST.
    await expect(
      callServerFn(probeEdgeCache, {
        data: { path: "//obcy.example.com/sekret" },
        context: KONTEKST,
      }),
    ).rejects.toThrow(/path must be a site-relative path/);

    expect(h.probeDocumentCache).not.toHaveBeenCalled();
  });

  it("odrzuca pustą ścieżkę i ciąg samych białych znaków", () => {
    // Po `trim()` zostaje pusty łańcuch, więc odrzuca go `min(1)` - inaczej
    // sonda pytałaby magazyn o klucz bez ścieżki.
    expect(() => validateServerFnInput(probeEdgeCache, { path: "" })).toThrow();
    expect(() => validateServerFnInput(probeEdgeCache, { path: "   " })).toThrow();
  });

  it("pilnuje granicy długości: 512 znaków przechodzi, 513 nie", () => {
    // Limit chroni klucz cache'a i logi przed wejściem generowanym maszynowo.
    // Asercja obejmuje OBIE strony granicy, bo pomyłka o jeden przy `max()`
    // jest tu najbardziej prawdopodobnym błędem.
    expect(
      validateServerFnInput<{ path: string }>(probeEdgeCache, { path: sciezkaDlugosci(512) }).path,
    ).toHaveLength(512);
    expect(() => validateServerFnInput(probeEdgeCache, { path: sciezkaDlugosci(513) })).toThrow();
  });

  it("odrzuca wejście, które w ogóle nie jest ścieżką (brak pola, zła forma)", () => {
    // Wywołanie z pominięciem UI (własny POST) nie ma prawa dostać się do
    // magazynu przez niezgodny kształt ładunku.
    expect(() => validateServerFnInput(probeEdgeCache, {})).toThrow();
    expect(() => validateServerFnInput(probeEdgeCache, { path: 7 })).toThrow();
    expect(() => validateServerFnInput(probeEdgeCache, undefined)).toThrow();
  });
});
