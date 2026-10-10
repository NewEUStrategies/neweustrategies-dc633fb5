// KARTA FUNDAMENTÓW TECHNICZNYCH - ŚCIEŻKA, W KTÓREJ SONDY ODPOWIADAJĄ.
//
// CZEGO BRAKOWAŁO. Karta miała dowód wyłącznie na wariant „nic nie odpowiada":
// w happy-dom `fetch` wywraca się na każdym adresie, więc test kokpitu
// przechodził przez `catch` w `probe()` i nigdy przez `res.text()` ani przez
// pętlę rysującą wiersze tabeli. Zmierzone przed tym plikiem: 15 z 18 linii
// i 5 z 12 gałęzi `TechnicalFoundationCard.tsx`.
//
// CO TU JEST PRZEDMIOTEM DOWODU - trzy rzeczy, każda z ceną awarii:
//
//  1. TREŚĆ ODPOWIEDZI DOCHODZI DO REGUŁ. `probe()` przycina ciało do
//     `FOUNDATION_BODY_LIMIT` i oddaje `{status, body}` - gdyby oddawało samą
//     odpowiedź, reguły widziałyby `[object Response]` i KAŻDY fundament
//     raportowałby się jako zepsuty przy w pełni sprawnym serwisie.
//  2. WIERSZ NA KAŻDY FUNDAMENT, z linkiem na PUBLICZNY ORIGIN TENANTA (dla
//     marki - domenę kanoniczną). Panel bywa otwarty na hoście podglądu; link
//     „Otwórz" prowadzący na host tymczasowy pokazywałby audytorowi plik,
//     którego nikt nie indeksuje.
//  3. SPADEK NA SAME-ORIGIN. Domena publiczna bez nagłówków CORS odrzuca
//     odczyt z panelu; karta ma wtedy pokazać stan plików, a nie cztery błędy.
//  4. ORIGIN PER-TENANT (2026-10). Karta sondowała i linkowała zawsze
//     `CANONICAL_SITE_ORIGIN`, więc admin innego tenanta widział stan mapy
//     strony, robots.txt i llms.txt MARKI - zielone wiersze o cudzym serwisie.
//     Teraz origin idzie z `useTenantPublicOrigin` (domena z `tenants.domain`,
//     inaczej reguła powierzchni maszynowych dla hosta karty).
//  5. GRANICA SPADKU NA SAME-ORIGIN (2026-10, runda 2). Pliki generowane nie
//     wysyłają CORS, więc z panelu na INNYM hoście niż domena tenanta odczyt
//     cross-origin pada zawsze - a względne `/sitemap.xml` to wtedy plik hosta
//     panelu (marki). Karta raportowała to jako 4x „OK" o cudzym serwisie.
//     Teraz spadek działa tylko dla hosta tego samego serwisu; poza nim wiersze
//     są „brak danych", a „Pobierz" znika. Do tego: padnięty odczyt domeny nie
//     uruchamia sond, a tenant bez domeny dostaje komunikat zamiast sond.
//  6. KAŻDY PLIK MAPY STRONY (2026-10-10). Karta liczyła `<sitemap>` w samym
//     indeksie i raportowała „OK - 6 plików sekcji", gdy Search Console miał
//     błędy w dwóch z nich (pusty `news-sitemap.xml`, niepobieralny
//     `sitemaps/core.xml`). Teraz pobiera indeks i każdy plik z indeksu,
//     waliduje je i pokazuje w tabeli „Pliki mapy strony" - a wiersz mapy
//     w tabeli fundamentów jest zielony tylko wtedy, gdy przechodzi KAŻDY plik.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { CANONICAL_SITE_ORIGIN } from "@/lib/http/host";
import { TechnicalFoundationCard } from "@/components/admin/seo/TechnicalFoundationCard";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const h = vi.hoisted(() => ({
  /** `tenants.domain` bieżącego tenanta (null = brak zajętej domeny). */
  tenantDomain: null as string | null,
  /** `tenants.is_default` (undefined = kolumna nieznana, jak w starszych atrapach). */
  tenantIsDefault: undefined as boolean | undefined,
  /** Błąd odczytu `tenants` (null = odczyt się udaje). */
  tenantError: null as Error | null,
  /** Ile razy karta pytała bazę o domenę. */
  tenantReads: 0,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ tenantId: "t-1" }) }));

// Jedyny odczyt bazy na tej karcie: domena WŁASNEGO tenanta.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const link = {
        select: () => link,
        eq: () => link,
        maybeSingle: () => {
          h.tenantReads += 1;
          return Promise.resolve(
            h.tenantError
              ? { data: null, error: h.tenantError }
              : { data: { domain: h.tenantDomain, is_default: h.tenantIsDefault }, error: null },
          );
        },
      };
      return link;
    },
  },
}));

/** Origin tenanta z własną domeną - przedmiot sekcji „origin per-tenant". */
const TENANT_ORIGIN = "https://analizy.example.org";

const NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
const NEWS_NS = 'xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"';

/** Cztery sondy fundamentów - w tej kolejności karta je wysyła. */
const FOUNDATION_PATHS = ["/sitemap.xml", "/robots.txt", "/llms.txt", "/"];

/**
 * Ciała plików w stanie „serwis zdrowy". Adresy w mapach leżą na originie
 * serwisu, który je podaje - walidator odrzuca adres z obcego hosta, więc
 * mapa tenanta musi nieść adresy tenanta.
 */
function healthy(site: string): Record<string, string> {
  return {
    "/sitemap.xml": `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex ${NS}>\n  <sitemap><loc>${site}/sitemaps/core.xml</loc></sitemap>\n  <sitemap><loc>${site}/news-sitemap.xml</loc><lastmod>2026-10-07T08:00:00Z</lastmod></sitemap>\n</sitemapindex>`,
    "/sitemaps/core.xml": `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${NS}>\n  <url><loc>${site}/</loc></url>\n  <url><loc>${site}/blog</loc><lastmod>2026-10-01</lastmod></url>\n</urlset>`,
    "/news-sitemap.xml": `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${NS} ${NEWS_NS}>\n  <url><loc>${site}/analizy/a</loc><news:news><news:publication><news:name>NES</news:name><news:language>pl</news:language></news:publication><news:publication_date>2026-10-07T08:00:00Z</news:publication_date><news:title>A</news:title></news:news></url>\n</urlset>`,
    "/robots.txt": `User-agent: *\nSitemap: ${site}/sitemap.xml`,
    "/llms.txt": "# llms.txt",
    "/": '<!doctype html><html lang="pl"><head></head><body></body></html>',
  };
}

/** Pusta news-sitemapa - bajt w bajt dokument z produkcji 2026-10-10. */
const EMPTY_NEWS = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${NS} ${NEWS_NS}>\n</urlset>`;

/** Origin i ścieżka adresu sondy - karta pyta raz na originie publicznym, raz same-origin. */
function split(target: string): { origin: string | null; path: string } {
  for (const origin of [CANONICAL_SITE_ORIGIN, TENANT_ORIGIN]) {
    if (target.startsWith(origin)) return { origin, path: target.slice(origin.length) };
  }
  return { origin: null, path: target };
}

function pathOf(target: string): string {
  return split(target).path;
}

/**
 * Atrapa `fetch` z listą adresów, na których ma ODMÓWIĆ (rzucić jak
 * przeglądarka przy braku CORS). Pozostałe oddają ciało ze `healthy()`
 * (z podmianami z `bodies`). Odczyt same-origin oddaje pliki serwisu `site`.
 */
function stubFetch(
  options: {
    rejectAbsolute?: boolean;
    site?: string;
    bodies?: Record<string, string>;
    status?: Record<string, number>;
    reject?: string[];
  } = {},
): string[] {
  const asked: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const target = String(input);
    asked.push(target);
    if (options.rejectAbsolute && target.startsWith("https://")) {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    const { origin, path } = split(target);
    if (options.reject?.includes(path)) return Promise.reject(new TypeError("Failed to fetch"));
    const site = origin ?? options.site ?? CANONICAL_SITE_ORIGIN;
    const body = options.bodies?.[path] ?? healthy(site)[path] ?? "";
    const isXml = path.endsWith(".xml");
    return Promise.resolve({
      status: options.status?.[path] ?? 200,
      headers: new Headers({
        "content-type": isXml ? "application/xml; charset=utf-8" : "text/plain; charset=utf-8",
      }),
      text: () => Promise.resolve(body),
    } as Response);
  });
  return asked;
}

/** Sondy czterech fundamentów (bez plików sekcji mapy), w kolejności wysłania. */
function foundationAsked(asked: readonly string[]): string[] {
  return asked.filter((target) => FOUNDATION_PATHS.includes(pathOf(target)));
}

/** Tabela fundamentów (bez tabeli plików mapy). */
function foundationTable(): HTMLElement {
  const table = document.querySelector<HTMLElement>("[data-seo-foundation]");
  if (!table) throw new Error("brak tabeli fundamentów");
  return table;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  h.tenantDomain = null;
  h.tenantIsDefault = undefined;
  h.tenantError = null;
  h.tenantReads = 0;
});

/** Host karty widziany przez hook - happy-dom nie zmienia go nawigacją. */
function stubBrowserHost(host: string) {
  vi.spyOn(window, "location", "get").mockReturnValue({
    ...window.location,
    host,
  } as Location);
}

/** `href` każdego linku „Otwórz" tabeli fundamentów, w kolejności wierszy (bez „Pobierz"). */
function openHrefs(): string[] {
  return within(foundationTable())
    .getAllByRole("link")
    .filter((link) => !link.hasAttribute("download"))
    .map((link) => link.getAttribute("href"))
    .filter((href): href is string => href !== null);
}

async function renderCard(): Promise<void> {
  renderWithQueryClient(<TechnicalFoundationCard />);
  await waitFor(() => expect(document.querySelector("[data-seo-foundation]")).not.toBeNull());
}

describe("TechnicalFoundationCard - sondy odpowiadają", () => {
  it("rysuje wiersz każdego fundamentu ze stanem policzonym z TREŚCI odpowiedzi", async () => {
    stubFetch();

    renderWithQueryClient(<TechnicalFoundationCard />);

    // Tabela pojawia się dopiero po rozstrzygnięciu czterech sond - do tego
    // czasu karta pokazuje wiersz ładowania.
    await waitFor(() => expect(document.querySelector("[data-seo-foundation]")).not.toBeNull());

    // Cztery fundamenty = cztery wiersze, w kolejności ze schematu sond.
    const rows = [...document.querySelectorAll("[data-seo-foundation] tbody tr")];
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.querySelector("td")?.textContent)).toEqual([
      "adminSeoHub.foundation_sitemap",
      "adminSeoHub.foundation_robots",
      "adminSeoHub.foundation_llms",
      "adminSeoHub.foundation_htmlLang",
    ]);

    // Stan liczony z CIAŁA, nie z samego kodu HTTP: indeks mapy wskazuje dwa
    // pliki (dwa adresy w mapie, artykuł News się nie dubluje), a
    // `<html lang="pl">` niesie konkretny język.
    // Gdyby `probe()` gubił treść, obie te wartości byłyby nie do policzenia.
    expect(
      screen.getByText("adminSeoHub.foundationSitemapIndexValid(files=2,urls=2,value=)"),
    ).toBeTruthy();
    expect(screen.getByText("adminSeoHub.foundationLangPresent(value=pl)")).toBeTruthy();
    // Wszystkie cztery na zielono -> podsumowanie sekcji.
    expect(within(foundationTable()).getAllByText("adminSeoHub.foundationState_ok")).toHaveLength(
      4,
    );
    expect(screen.getByText("adminSeoHub.foundationAllGood")).toBeTruthy();
  });

  it("link otwierający plik prowadzi na DOMENĘ KANONICZNĄ, nie na host panelu", async () => {
    // Marka: tenant bez zajętej domeny, panel na hoście testowym (localhost) -
    // reguła powierzchni maszynowych daje origin kanoniczny.
    stubFetch();

    await renderCard();

    expect(openHrefs()).toEqual([
      `${CANONICAL_SITE_ORIGIN}/sitemap.xml`,
      `${CANONICAL_SITE_ORIGIN}/robots.txt`,
      `${CANONICAL_SITE_ORIGIN}/llms.txt`,
      `${CANONICAL_SITE_ORIGIN}/`,
    ]);
  });

  it("sitemap, robots i llms można pobrać jako plik z tego samego hosta", async () => {
    stubFetch({});
    renderWithQueryClient(<TechnicalFoundationCard />);
    await waitFor(() => expect(document.querySelector("[data-seo-foundation]")).not.toBeNull());
    const downloads = [...foundationTable().querySelectorAll("a[download]")].map((a) => [
      a.getAttribute("href"),
      a.getAttribute("download"),
    ]);
    expect(downloads).toEqual([
      ["/sitemap.xml", "sitemap.xml"],
      ["/robots.txt", "robots.txt"],
      ["/llms.txt", "llms.txt"],
    ]);
  });

  it("odmowa cross-origin spada na same-origin zamiast raportować cztery błędy", async () => {
    // Domena publikacji bez nagłówków CORS odrzuca odczyt z panelu. Treść
    // plików generowanych jest na obu hostach identyczna, więc karta ma pokazać
    // STAN, a nie „brak odpowiedzi" - inaczej redakcja ściga awarię, której nie ma.
    const asked = stubFetch({ rejectAbsolute: true });

    await renderCard();

    const absolute = foundationAsked(asked).filter((t) => t.startsWith(CANONICAL_SITE_ORIGIN));
    expect(absolute).toHaveLength(4);
    expect(foundationAsked(asked).filter((target) => !target.startsWith("https://"))).toEqual(
      FOUNDATION_PATHS,
    );
    // Pliki sekcji z indeksu idą tą samą drogą: odmowa cross-origin -> same-origin.
    expect(asked).toContain("/sitemaps/core.xml");
    expect(asked).toContain("/news-sitemap.xml");
    expect(within(foundationTable()).getAllByText("adminSeoHub.foundationState_ok")).toHaveLength(
      4,
    );
  });
});

describe("TechnicalFoundationCard - origin per-tenant", () => {
  it("tenant z własną domeną: sondy pytają JEGO origin, nie domenę marki", async () => {
    h.tenantDomain = "analizy.example.org";
    const asked = stubFetch();

    await renderCard();

    // Sondy czekają na domenę z bazy: ani jednego pytania o pliki marki, także
    // „na chwilę", zanim domena dojedzie - inaczej karta mignęłaby stanem
    // cudzego serwisu (i zostawiła go w cache na minutę świeżości).
    expect(foundationAsked(asked)).toEqual([
      `${TENANT_ORIGIN}/sitemap.xml`,
      `${TENANT_ORIGIN}/robots.txt`,
      `${TENANT_ORIGIN}/llms.txt`,
      `${TENANT_ORIGIN}/`,
    ]);
    // Pliki sekcji z indeksu tenanta - też na JEGO originie.
    expect(asked.every((target) => target.startsWith(TENANT_ORIGIN))).toBe(true);
    expect(asked).toContain(`${TENANT_ORIGIN}/sitemaps/core.xml`);
  });

  it("tenant z własną domeną: linki „Otwórz” prowadzą na JEGO pliki", async () => {
    h.tenantDomain = "analizy.example.org";
    stubFetch();

    await renderCard();

    expect(openHrefs()).toEqual([
      `${TENANT_ORIGIN}/sitemap.xml`,
      `${TENANT_ORIGIN}/robots.txt`,
      `${TENANT_ORIGIN}/llms.txt`,
      `${TENANT_ORIGIN}/`,
    ]);
    // Negatyw: ani jeden link nie wskazuje marki.
    expect(openHrefs().some((href) => href.startsWith(CANONICAL_SITE_ORIGIN))).toBe(false);
    // „Pobierz" ZNIKA, gdy panel (tu: localhost = host marki) nie jest hostem
    // tenanta: same-origin pobrałby plik marki pod nazwą pliku tenanta.
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it("tenant oglądany z hosta marki bez CORS: NIE spada na same-origin (pliki marki)", async () => {
    // Odwrócony przypięty stan z 1. rundy („spadek działa jak dla marki").
    // jsdom/happy-dom to localhost, czyli host tenanta DOMYŚLNEGO - względne
    // adresy oddałyby pliki marki, a karta raportowała je jako stan tenanta.
    h.tenantDomain = "analizy.example.org";
    const asked = stubFetch({ rejectAbsolute: true });

    await renderCard();

    expect(asked).toEqual([
      `${TENANT_ORIGIN}/sitemap.xml`,
      `${TENANT_ORIGIN}/robots.txt`,
      `${TENANT_ORIGIN}/llms.txt`,
      `${TENANT_ORIGIN}/`,
    ]);
    expect(screen.queryByText("adminSeoHub.foundationState_ok")).toBeNull();
    expect(screen.getAllByText("adminSeoHub.foundationState_unknown")).toHaveLength(4);
    expect(
      screen.getAllByText("adminSeoHub.foundationCrossHost(value=analizy.example.org)"),
    ).toHaveLength(4);
    expect(document.querySelector("[data-seo-foundation-cross-host]")?.textContent).toBe(
      "adminSeoHub.foundationCrossHostNote(value=analizy.example.org)",
    );
    expect(screen.queryByText("adminSeoHub.foundationAllGood")).toBeNull();
  });

  it("tenant na WŁASNEJ domenie bez CORS: spadek na same-origin działa i „Pobierz” wraca", async () => {
    stubBrowserHost("analizy.example.org");
    h.tenantDomain = "analizy.example.org";
    const asked = stubFetch({ rejectAbsolute: true, site: TENANT_ORIGIN });

    await renderCard();

    expect(foundationAsked(asked).filter((target) => !target.startsWith("https://"))).toEqual(
      FOUNDATION_PATHS,
    );
    expect(within(foundationTable()).getAllByText("adminSeoHub.foundationState_ok")).toHaveLength(
      4,
    );
    expect(document.querySelector("[data-seo-foundation-cross-host]")).toBeNull();
    expect(
      [...foundationTable().querySelectorAll("a[download]")].map((a) => a.getAttribute("href")),
    ).toEqual(["/sitemap.xml", "/robots.txt", "/llms.txt"]);
  });

  it("domena marki w bazie (tenant domyślny) zostaje na DOMENIE KANONICZNEJ", async () => {
    h.tenantDomain = "www.neweuropeanstrategies.com";
    const asked = stubFetch();

    await renderCard();

    expect(openHrefs()[0]).toBe(`${CANONICAL_SITE_ORIGIN}/sitemap.xml`);
    expect(asked.every((target) => !target.startsWith("https://www."))).toBe(true);
  });
});

describe("TechnicalFoundationCard - origin nierozstrzygnięty albo nieistniejący", () => {
  it("padnięty odczyt domeny: ZERO sond, komunikat i ponowienie", async () => {
    h.tenantError = new Error("permission denied for table tenants");
    const asked = stubFetch();

    renderWithQueryClient(<TechnicalFoundationCard />);

    await waitFor(() =>
      expect(document.querySelector('[data-seo-foundation-origin="failed"]')).not.toBeNull(),
    );
    // Origin tymczasowy (host karty = marka) NIE jest sondowany.
    expect(asked).toEqual([]);
    expect(document.querySelector("[data-seo-foundation]")).toBeNull();

    // Ponowienie po ustąpieniu awarii: domena dojeżdża i dopiero wtedy sondy.
    h.tenantError = null;
    h.tenantDomain = "analizy.example.org";
    fireEvent.click(screen.getByText("adminSeoHub.foundationOriginRetry"));
    await waitFor(() => expect(document.querySelector("[data-seo-foundation]")).not.toBeNull());
    expect(h.tenantReads).toBe(2);
    expect(asked.every((target) => target.startsWith(TENANT_ORIGIN))).toBe(true);
  });

  it("tenant niedomyślny bez domeny: komunikat zamiast sond na pliki marki", async () => {
    h.tenantDomain = null;
    h.tenantIsDefault = false;
    const asked = stubFetch();

    renderWithQueryClient(<TechnicalFoundationCard />);

    await waitFor(() =>
      expect(document.querySelector('[data-seo-foundation-origin="none"]')).not.toBeNull(),
    );
    expect(screen.getByText("adminSeoHub.noPublicDomain")).toBeTruthy();
    expect(asked).toEqual([]);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("TechnicalFoundationCard - pliki mapy strony (2026-10-10)", () => {
  async function renderFiles(): Promise<HTMLElement> {
    renderWithQueryClient(<TechnicalFoundationCard />);
    await waitFor(() => expect(document.querySelector("[data-seo-sitemap-files]")).not.toBeNull());
    return document.querySelector<HTMLElement>("[data-seo-sitemap-files]")!;
  }

  function fileRow(path: string): HTMLElement {
    const row = document.querySelector<HTMLElement>(`[data-seo-sitemap-file="${path}"]`);
    if (!row) throw new Error(`brak wiersza pliku ${path}`);
    return row;
  }

  it("indeks i KAŻDY plik z indeksu dostają wiersz ze stanem, zawartością i linkami", async () => {
    stubFetch();
    await renderFiles();

    const rows = [...document.querySelectorAll("[data-seo-sitemap-file]")];
    expect(rows.map((row) => row.getAttribute("data-seo-sitemap-file"))).toEqual([
      "/sitemap.xml",
      "/sitemaps/core.xml",
      "/news-sitemap.xml",
    ]);
    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual(["ok", "ok", "ok"]);
    expect(
      within(fileRow("/sitemaps/core.xml")).getByText("adminSeoHub.sitemapKind_urlset"),
    ).toBeTruthy();
    expect(
      within(fileRow("/sitemaps/core.xml")).getByText("adminSeoHub.sitemapEntries_urlset(n=2)"),
    ).toBeTruthy();
    expect(
      within(fileRow("/sitemaps/core.xml")).getByText(
        "adminSeoHub.sitemapLastmod(value=2026-10-01)",
      ),
    ).toBeTruthy();
    expect(
      within(fileRow("/news-sitemap.xml")).getByText("adminSeoHub.sitemapKind_news"),
    ).toBeTruthy();
    // „Otwórz" na originie publicznym, „Pobierz" same-origin z nazwą pliku.
    const core = fileRow("/sitemaps/core.xml");
    expect(
      within(core)
        .getAllByRole("link")
        .map((link) => [link.getAttribute("href"), link.getAttribute("download")]),
    ).toEqual([
      [`${CANONICAL_SITE_ORIGIN}/sitemaps/core.xml`, null],
      ["/sitemaps/core.xml", "core.xml"],
    ]);
  });

  it("pusty news-sitemap (jak w GSC): wiersz pliku z błędem „brak tagu url, wiersz 3”, mapa NIE jest zielona", async () => {
    stubFetch({ bodies: { "/news-sitemap.xml": EMPTY_NEWS } });
    await renderFiles();

    expect(fileRow("/news-sitemap.xml").getAttribute("data-state")).toBe("fail");
    expect(
      within(fileRow("/news-sitemap.xml")).getByText(
        "adminSeoHub.sitemapIssue_missingTag(parent=urlset,tag=url,value=) · adminSeoHub.sitemapIssueLine(n=3)",
      ),
    ).toBeTruthy();
    // Dawny defekt: indeks zdrowy -> wiersz mapy „OK". Teraz wiersz mapy to
    // najgorszy plik, a podsumowanie „wszystko dobrze" znika.
    expect(
      within(foundationTable()).getByText(
        "adminSeoHub.foundationSitemapFilesFailed(failed=1,total=3,value=)",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("adminSeoHub.foundationAllGood")).toBeNull();
  });

  it("plik sekcji bez odpowiedzi: komunikat „Ogólny błąd HTTP” zamiast fałszywego OK", async () => {
    stubFetch({ reject: ["/sitemaps/core.xml"] });
    await renderFiles();

    const core = fileRow("/sitemaps/core.xml");
    expect(core.getAttribute("data-state")).toBe("fail");
    expect(core.querySelector('[data-seo-sitemap-issue="http"]')?.textContent).toBe(
      "adminSeoHub.sitemapIssue_network(parent=,tag=,value=0)",
    );
  });

  it("5xx pliku sekcji to błąd HTTP z kodem", async () => {
    stubFetch({ status: { "/sitemaps/core.xml": 503 } });
    await renderFiles();
    expect(
      fileRow("/sitemaps/core.xml").querySelector('[data-seo-sitemap-issue="http"]')?.textContent,
    ).toBe("adminSeoHub.sitemapIssue_http(parent=,tag=,value=503)");
  });

  it("„Sprawdź ponownie” pobiera pliki jeszcze raz (np. po naprawie)", async () => {
    const asked = stubFetch({ bodies: { "/news-sitemap.xml": EMPTY_NEWS } });
    await renderFiles();
    expect(fileRow("/news-sitemap.xml").getAttribute("data-state")).toBe("fail");
    const before = asked.length;

    stubFetch();
    fireEvent.click(document.querySelector<HTMLElement>("[data-seo-sitemap-recheck]")!);
    await waitFor(() => expect(fileRow("/news-sitemap.xml").getAttribute("data-state")).toBe("ok"));
    expect(before).toBeGreaterThan(0);
  });

  it("indeks nieczytelny z tego hosta (tenant oglądany z marki): brak tabeli plików", async () => {
    h.tenantDomain = "analizy.example.org";
    stubFetch({ rejectAbsolute: true });
    await renderCard();
    expect(document.querySelector("[data-seo-sitemap-files]")).toBeNull();
  });
});
