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
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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

/** Ciała czterech sond w stanie „serwis zdrowy". */
const HEALTHY: Record<string, string> = {
  "/sitemap.xml": "<sitemapindex><sitemap>a</sitemap><sitemap>b</sitemap></sitemapindex>",
  "/robots.txt": `User-agent: *\nSitemap: ${CANONICAL_SITE_ORIGIN}/sitemap.xml`,
  "/llms.txt": "# llms.txt",
  "/": '<!doctype html><html lang="pl"><head></head><body></body></html>',
};

/** Ścieżka adresu sondy - karta pyta raz na originie publicznym, raz same-origin. */
function pathOf(target: string): string {
  for (const origin of [CANONICAL_SITE_ORIGIN, TENANT_ORIGIN]) {
    if (target.startsWith(origin)) return target.slice(origin.length);
  }
  return target;
}

/**
 * Atrapa `fetch` z listą adresów, na których ma ODMÓWIĆ (rzucić jak
 * przeglądarka przy braku CORS). Pozostałe oddają ciało ze `HEALTHY`.
 */
function stubFetch(options: { rejectAbsolute?: boolean } = {}): string[] {
  const asked: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const target = String(input);
    asked.push(target);
    if (options.rejectAbsolute && target.startsWith("https://")) {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    const body = HEALTHY[pathOf(target)] ?? "";
    return Promise.resolve({ status: 200, text: () => Promise.resolve(body) } as Response);
  });
  return asked;
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

/** `href` każdego linku „Otwórz", w kolejności wierszy (bez linków „Pobierz"). */
function openHrefs(): string[] {
  return screen
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

    // Stan liczony z CIAŁA, nie z samego kodu HTTP: indeks mapy ma dwa shardy,
    // a `<html lang="pl">` niesie konkretny język. Gdyby `probe()` gubił treść,
    // obie te wartości byłyby nie do policzenia.
    expect(screen.getByText("adminSeoHub.foundationSitemapIndex(value=2)")).toBeTruthy();
    expect(screen.getByText("adminSeoHub.foundationLangPresent(value=pl)")).toBeTruthy();
    // Wszystkie cztery na zielono -> podsumowanie sekcji.
    expect(screen.getAllByText("adminSeoHub.foundationState_ok")).toHaveLength(4);
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
    const downloads = [...document.querySelectorAll("a[download]")].map((a) => [
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

    expect(asked.filter((target) => target.startsWith(CANONICAL_SITE_ORIGIN))).toHaveLength(4);
    expect(asked.filter((target) => !target.startsWith("https://"))).toEqual([
      "/sitemap.xml",
      "/robots.txt",
      "/llms.txt",
      "/",
    ]);
    expect(screen.getAllByText("adminSeoHub.foundationState_ok")).toHaveLength(4);
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
    expect(asked).toEqual([
      `${TENANT_ORIGIN}/sitemap.xml`,
      `${TENANT_ORIGIN}/robots.txt`,
      `${TENANT_ORIGIN}/llms.txt`,
      `${TENANT_ORIGIN}/`,
    ]);
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
    const asked = stubFetch({ rejectAbsolute: true });

    await renderCard();

    expect(asked.filter((target) => !target.startsWith("https://"))).toEqual([
      "/sitemap.xml",
      "/robots.txt",
      "/llms.txt",
      "/",
    ]);
    expect(screen.getAllByText("adminSeoHub.foundationState_ok")).toHaveLength(4);
    expect(document.querySelector("[data-seo-foundation-cross-host]")).toBeNull();
    expect(
      [...document.querySelectorAll("a[download]")].map((a) => a.getAttribute("href")),
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
