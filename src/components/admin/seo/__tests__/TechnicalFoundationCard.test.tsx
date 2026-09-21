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
//  2. WIERSZ NA KAŻDY FUNDAMENT, z linkiem na DOMENĘ KANONICZNĄ. Panel bywa
//     otwarty na hoście podglądu; link „Otwórz" prowadzący na host tymczasowy
//     pokazywałby audytorowi plik, którego nikt nie indeksuje.
//  3. SPADEK NA SAME-ORIGIN. Domena kanoniczna bez nagłówków CORS odrzuca
//     odczyt z panelu; karta ma wtedy pokazać stan plików, a nie cztery błędy.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { CANONICAL_SITE_ORIGIN } from "@/lib/http/host";
import { TechnicalFoundationCard } from "@/components/admin/seo/TechnicalFoundationCard";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

/** Ciała czterech sond w stanie „serwis zdrowy". */
const HEALTHY: Record<string, string> = {
  "/sitemap.xml": "<sitemapindex><sitemap>a</sitemap><sitemap>b</sitemap></sitemapindex>",
  "/robots.txt": `User-agent: *\nSitemap: ${CANONICAL_SITE_ORIGIN}/sitemap.xml`,
  "/llms.txt": "# llms.txt",
  "/": '<!doctype html><html lang="pl"><head></head><body></body></html>',
};

/** Ścieżka adresu sondy - karta pyta raz kanonicznie, raz same-origin. */
function pathOf(target: string): string {
  return target.startsWith(CANONICAL_SITE_ORIGIN)
    ? target.slice(CANONICAL_SITE_ORIGIN.length)
    : target;
}

/**
 * Atrapa `fetch` z listą adresów, na których ma ODMÓWIĆ (rzucić jak
 * przeglądarka przy braku CORS). Pozostałe oddają ciało ze `HEALTHY`.
 */
function stubFetch(options: { rejectCanonical?: boolean } = {}): string[] {
  const asked: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const target = String(input);
    asked.push(target);
    if (options.rejectCanonical && target.startsWith(CANONICAL_SITE_ORIGIN)) {
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
});

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
    stubFetch();

    renderWithQueryClient(<TechnicalFoundationCard />);
    await waitFor(() => expect(document.querySelector("[data-seo-foundation]")).not.toBeNull());

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .filter((href): href is string => href !== null);
    expect(hrefs).toEqual([
      `${CANONICAL_SITE_ORIGIN}/sitemap.xml`,
      `${CANONICAL_SITE_ORIGIN}/robots.txt`,
      `${CANONICAL_SITE_ORIGIN}/llms.txt`,
      `${CANONICAL_SITE_ORIGIN}/`,
    ]);
  });

  it("odmowa cross-origin spada na same-origin zamiast raportować cztery błędy", async () => {
    // Domena publikacji bez nagłówków CORS odrzuca odczyt z panelu. Treść
    // plików generowanych jest na obu hostach identyczna, więc karta ma pokazać
    // STAN, a nie „brak odpowiedzi" - inaczej redakcja ściga awarię, której nie ma.
    const asked = stubFetch({ rejectCanonical: true });

    renderWithQueryClient(<TechnicalFoundationCard />);
    await waitFor(() => expect(document.querySelector("[data-seo-foundation]")).not.toBeNull());

    expect(asked.filter((target) => target.startsWith(CANONICAL_SITE_ORIGIN))).toHaveLength(4);
    expect(asked.filter((target) => !target.startsWith(CANONICAL_SITE_ORIGIN))).toEqual([
      "/sitemap.xml",
      "/robots.txt",
      "/llms.txt",
      "/",
    ]);
    expect(screen.getAllByText("adminSeoHub.foundationState_ok")).toHaveLength(4);
  });
});
