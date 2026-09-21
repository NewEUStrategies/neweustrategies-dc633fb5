/**
 * <HeaderSkeleton /> - miejsce trzymane dla nagłówka, zanim dojadą ustawienia.
 *
 * CO TEN PLIK PRZYPINA (i dlaczego akurat to).
 *  1. GEOMETRIA Z PROPSÓW. Szkielet ma rezerwować tyle pikseli, ile naprawdę
 *     zajmie nagłówek: pasek alertu + „na czasie" + baner + rzędy nawigacji.
 *     Stałe 64 px (`h-16`) zaniżały go o ponad 100 px, a `return null`
 *     w `Header.tsx` rezerwował zero - to była najdroższa pozycja w audycie
 *     CLS. Asercje idą na SUMĘ wysokości pasów, bo to ona jest kontraktem
 *     wobec układu, a nie liczba divów.
 *  2. RZĘDY Z DOKUMENTU NAGŁÓWKA. `navRows: 1` na sztywno rezerwowało JEDEN
 *     pas 64 px wobec dwurzędowego nagłówka o realnych 147 px (artefakt
 *     produkcyjny, fixture `first-visit`, 1280 px) - regresja CLS 0,13 przy
 *     progu 0,1 w „first visit pl, cold". Rezerwa liczy się teraz z tego
 *     samego `header.builder_data`, które renderuje `BuilderRenderer`.
 *  3. WYPROWADZENIE PROPSÓW Z USTAWIEŃ. `headerSkeletonPropsFromSettings` to
 *     jedyne miejsce, które tłumaczy `site_settings` na geometrię; bez mapy
 *     ustawień musi dawać wariant domyślny (nawigacja + ticker), bo tak
 *     wygląda większość dokumentów.
 *  4. ZERO KOSZTU SIECIOWEGO. `useHeaderSkeletonProps` czyta cache przez
 *     `getQueryData` - szkielet pokazuje się dokładnie w zimnym starcie, więc
 *     nie wolno mu dokładać round-tripu. Test dowodzi, że bez `queryFn`
 *     w cache'u nic się nie pobiera, a wynik schodzi do defaultów.
 *  5. DOSTĘPNOŚĆ. Placeholder jest `aria-hidden`, nie ma tekstu ani elementów
 *     interaktywnych - inaczej łapałby fokus z klawiatury i prowadził donikąd.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  HEADER_SKELETON_BANDS,
  HEADER_SKELETON_DEFAULT_PROPS,
  HEADER_SKELETON_NAV_MAX_PX,
  HEADER_SKELETON_ROW_MAX_PX,
  HEADER_SKELETON_ROW_MIN_PX,
  HeaderSkeleton,
  clampNavRows,
  headerSkeletonHeight,
  headerSkeletonPropsFromSettings,
  useHeaderSkeletonProps,
  type HeaderSkeletonProps,
} from "@/components/header/HeaderSkeleton";
import {
  HEADER_TICKER_BAND_CLASS,
  HEADER_TICKER_BORDER_CLASS,
} from "@/components/header/headerGeometry";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import type { BuilderDocument } from "@/lib/builder/types";

/**
 * Suma wysokości pasów WIDOCZNYCH NA DESKTOPIE (px). Pas mobilny (`lg:hidden`)
 * i rzędy nagłówka (`hidden lg:*`) są rozłączne - jsdom nie liczy mediów, więc
 * sumujemy to, co widzi desktop, czyli dokładnie kontrakt
 * `headerSkeletonHeight`.
 */
function renderedHeight(container: HTMLElement): number {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-skeleton-band]"))
    .filter((band) => band.dataset.skeletonBand !== "nav-mobile")
    .reduce((total, band) => {
      const inline = Number.parseFloat(band.style.height || "0");
      // Pas „na czasie" nie ma wysokości inline: dzieli klasę `h-10` z samym
      // paskiem (patrz headerGeometry), więc w sumie liczy się jego wartość
      // nominalna.
      return (
        total + (Number.isFinite(inline) && inline > 0 ? inline : HEADER_SKELETON_BANDS.ticker)
      );
    }, 0);
}

/** Dokument nagłówka o zadanych kolumnach - minimum, które czyta estymator. */
function headerDoc(...rows: Array<Array<{ type: string; height?: number }>>): BuilderDocument {
  return {
    version: 1,
    sections: rows.map((widgets, r) => ({
      id: `sec-${r}`,
      kind: "section" as const,
      children: [
        {
          id: `col-${r}`,
          kind: "column" as const,
          children: widgets.map((w, i) => ({
            id: `w-${r}-${i}`,
            kind: "widget" as const,
            type: w.type,
            ...(w.height ? { advanced: { height: { desktop: w.height } } } : {}),
          })),
        },
      ],
    })),
  } as unknown as BuilderDocument;
}

describe("HeaderSkeleton - geometria z propsów", () => {
  it("domyślnie rezerwuje pas nawigacji i pas „na czasie”", () => {
    const { container } = render(<HeaderSkeleton />);
    expect(headerSkeletonHeight()).toBe(
      HEADER_SKELETON_BANDS.ticker + HEADER_SKELETON_BANDS.navRow,
    );
    expect(renderedHeight(container)).toBe(headerSkeletonHeight());
    expect(container.querySelector('[data-skeleton-band="alert-bar"]')).toBeNull();
    expect(container.querySelector('[data-skeleton-band="ad-banner"]')).toBeNull();
  });

  it.each<[string, HeaderSkeletonProps]>([
    ["sam pasek nawigacji", { ticker: false }],
    ["alert + ticker + baner", { alertBar: true, ticker: true, adBanner: true }],
    ["dwa rzędy nawigacji", { navRows: [90, 57] }],
    ["pełny nagłówek", { alertBar: true, ticker: true, adBanner: true, navRows: [88, 56, 40] }],
  ])("%s: wyrenderowane pasy sumują się do zadeklarowanej wysokości", (_nazwa, props) => {
    const { container } = render(<HeaderSkeleton {...props} />);
    expect(renderedHeight(container)).toBe(headerSkeletonHeight(props));
  });

  it("każdy włączony pas dokłada wysokość, żaden nie odejmuje", () => {
    const base = headerSkeletonHeight({ alertBar: false, ticker: false, adBanner: false });
    expect(base).toBe(HEADER_SKELETON_BANDS.navRow);
    expect(headerSkeletonHeight({ alertBar: true, ticker: false, adBanner: false })).toBe(
      base + HEADER_SKELETON_BANDS.alertBar,
    );
    expect(headerSkeletonHeight({ ticker: true, alertBar: false, adBanner: false })).toBe(
      base + HEADER_SKELETON_BANDS.ticker,
    );
    expect(headerSkeletonHeight({ adBanner: true, alertBar: false, ticker: false })).toBe(
      base + HEADER_SKELETON_BANDS.adBanner,
    );
  });

  it("pas „na czasie” dzieli klasę wysokości z samym paskiem, bez wysokości inline", () => {
    // Root font-size jest w tym repo płynny (1280 -> 1920 px), więc rezerwa
    // zapisana liczbą rozjeżdżałaby się z `h-10` realnego paska.
    const { container } = render(<HeaderSkeleton ticker />);
    const band = container.querySelector<HTMLElement>('[data-skeleton-band="ticker"]')!;
    expect(band.style.height).toBe("");
    for (const cls of `${HEADER_TICKER_BAND_CLASS} ${HEADER_TICKER_BORDER_CLASS}`.split(" "))
      expect(band.className).toContain(cls);
  });

  it("pasek mobilny i rzędy desktopu są rozłączne - dokładnie jak w Header.tsx", () => {
    const { container } = render(<HeaderSkeleton navRows={[90, 57]} />);
    const mobile = container.querySelector<HTMLElement>('[data-skeleton-band="nav-mobile"]')!;
    expect(mobile.className).toContain("lg:hidden");
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-skeleton-band="nav"]'));
    expect(rows.map((row) => row.style.height)).toEqual(["90px", "57px"]);
    for (const row of rows) expect(row.className).toContain("lg:flex");
  });

  it("wysokości rzędów są przycinane do widełek, także dla śmieci z bazy", () => {
    expect(clampNavRows(undefined)).toEqual([HEADER_SKELETON_BANDS.navRow]);
    expect(clampNavRows([])).toEqual([HEADER_SKELETON_BANDS.navRow]);
    expect(clampNavRows([0, Number.NaN, -5])).toEqual([HEADER_SKELETON_BANDS.navRow]);
    expect(clampNavRows([1])).toEqual([HEADER_SKELETON_ROW_MIN_PX]);
    expect(clampNavRows([10_000])).toEqual([HEADER_SKELETON_ROW_MAX_PX]);
    // Sufit całej rezerwy: nadmiarowe rzędy odpadają zamiast malować ekran pustki.
    const total = clampNavRows([200, 200, 200, 200]).reduce((sum, row) => sum + row, 0);
    expect(total).toBeLessThanOrEqual(HEADER_SKELETON_NAV_MAX_PX);
  });
});

describe("HeaderSkeleton - dostępność placeholdera", () => {
  it("jest ukryty przed czytnikiem ekranu, bez tekstu i bez fokusu", () => {
    const { container } = render(<HeaderSkeleton alertBar ticker adBanner navRows={[90, 57]} />);
    const root = container.firstElementChild!;
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).toHaveAttribute("data-skeleton", "header");
    expect(root.textContent).toBe("");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("headerSkeletonPropsFromSettings - ustawienia na geometrię", () => {
  it("bez mapy ustawień daje wariant domyślny", () => {
    expect(headerSkeletonPropsFromSettings(undefined)).toEqual(HEADER_SKELETON_DEFAULT_PROPS);
  });

  it("wyłączony ticker gasi pas „na czasie”", () => {
    const props = headerSkeletonPropsFromSettings({ header: { trending: { enabled: false } } });
    expect(props.ticker).toBe(false);
    expect(headerSkeletonHeight(props)).toBe(HEADER_SKELETON_BANDS.navRow);
  });

  it("pasek alertu liczy się dopiero z treścią, bo bez niej AlertBar zwraca null", () => {
    const wlaczony = { header: { alert_bar: { enabled: true, message_pl: "Uwaga" } } };
    expect(headerSkeletonPropsFromSettings({ theme_options: wlaczony }).alertBar).toBe(true);
    expect(
      headerSkeletonPropsFromSettings({
        theme_options: { header: { alert_bar: { enabled: true, message_pl: "   " } } },
      }).alertBar,
    ).toBe(false);
    expect(
      headerSkeletonPropsFromSettings({
        theme_options: { header: { alert_bar: { enabled: false, message_pl: "Uwaga" } } },
      }).alertBar,
    ).toBe(false);
  });

  it("obecność banera nagłówka przychodzi z zewnątrz (cache placementów)", () => {
    expect(headerSkeletonPropsFromSettings({}, true).adBanner).toBe(true);
    expect(headerSkeletonPropsFromSettings({}, false).adBanner).toBe(false);
  });

  it("REGRESJA CLS: dwurzędowy nagłówek rezerwuje DWA rzędy, nie jeden", () => {
    // Do 2026-09-21 mapowanie zwracało `navRows: 1` niezależnie od dokumentu,
    // więc szkielet trzymał jeden pas 64 px pod dwurzędowym nagłówkiem.
    const props = headerSkeletonPropsFromSettings({
      header: {
        trending: { enabled: true },
        builder_data: headerDoc(
          [{ type: "image", height: 64 }],
          [{ type: "search-button" }, { type: "menu" }],
        ),
      },
    });
    expect(props.navRows).toHaveLength(2);
    // Rząd 1: obrazek o wysokości autorskiej 64 + 2x12 bezpiecznego marginesu.
    expect(props.navRows[0]).toBe(88);
    expect(headerSkeletonHeight(props)).toBeGreaterThan(
      HEADER_SKELETON_BANDS.ticker + HEADER_SKELETON_BANDS.navRow,
    );
  });

  it("pusty dokument nagłówka wraca do jednego awaryjnego rzędu", () => {
    const props = headerSkeletonPropsFromSettings({
      header: { builder_data: { version: 1, sections: [] } },
    });
    expect(props.navRows).toEqual([HEADER_SKELETON_BANDS.navRow]);
  });
});

describe("useHeaderSkeletonProps - czyta cache, nie sieć", () => {
  function Probe({ adPageType = "all" as const }) {
    const props = useHeaderSkeletonProps(adPageType);
    return <span data-testid="props">{JSON.stringify(props)}</span>;
  }

  function odczyt(qc: QueryClient) {
    render(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    );
    return JSON.parse(screen.getByTestId("props").textContent!);
  }

  it("pusty cache schodzi do wariantu domyślnego i nie odpala zapytania", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(odczyt(qc)).toEqual(HEADER_SKELETON_DEFAULT_PROPS);
    // Zero wpisów w cache'u = zero round-tripów w zimnym starcie.
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it("czyta ustawienia i placementy banera z cache'a rozgrzanego przez SSR", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(siteSettingsQueryOptions.queryKey, {
      header: { trending: { enabled: false } },
      theme_options: { header: { alert_bar: { enabled: true, message_en: "Heads up" } } },
    });
    qc.setQueryData(["ad_placements", "header_banner", "all", null], [{ id: "p1" }]);
    expect(odczyt(qc)).toEqual({
      alertBar: true,
      ticker: false,
      adBanner: true,
      navRows: [HEADER_SKELETON_BANDS.navRow],
    });
  });
});
