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
 *  2. WYPROWADZENIE PROPSÓW Z USTAWIEŃ. `headerSkeletonPropsFromSettings` to
 *     jedyne miejsce, które tłumaczy `site_settings` na geometrię; bez mapy
 *     ustawień musi dawać wariant domyślny (nawigacja + ticker), bo tak
 *     wygląda większość dokumentów.
 *  3. ZERO KOSZTU SIECIOWEGO. `useHeaderSkeletonProps` czyta cache przez
 *     `getQueryData` - szkielet pokazuje się dokładnie w zimnym starcie, więc
 *     nie wolno mu dokładać round-tripu. Test dowodzi, że bez `queryFn`
 *     w cache'u nic się nie pobiera, a wynik schodzi do defaultów.
 *  4. DOSTĘPNOŚĆ. Placeholder jest `aria-hidden`, nie ma tekstu ani elementów
 *     interaktywnych - inaczej łapałby fokus z klawiatury i prowadził donikąd.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  HEADER_SKELETON_BANDS,
  HEADER_SKELETON_DEFAULT_PROPS,
  HeaderSkeleton,
  headerSkeletonHeight,
  headerSkeletonPropsFromSettings,
  useHeaderSkeletonProps,
  type HeaderSkeletonProps,
} from "@/components/header/HeaderSkeleton";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";

/** Suma wysokości wszystkich pasów wyrenderowanego szkieletu (px). */
function renderedHeight(container: HTMLElement): number {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-skeleton-band]")).reduce(
    (total, band) => {
      // Pasy reklam/alertu/tickera niosą wysokość inline, rząd nawigacji -
      // klasą `h-16` (ta sama, co mobilny pasek nagłówka).
      const inline = Number.parseFloat(band.style.height || "0");
      return total + (Number.isFinite(inline) && inline > 0 ? inline : HEADER_SKELETON_BANDS.navRow);
    },
    0,
  );
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
    ["dwa rzędy nawigacji", { navRows: 2 }],
    ["pełny nagłówek", { alertBar: true, ticker: true, adBanner: true, navRows: 3 }],
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

  it("liczba rzędów nawigacji jest przycinana do 1-3, także dla śmieci", () => {
    // Wartość z ustawień może być czymkolwiek - zero rzędów to znowu 0 px
    // nagłówka, a trzydzieści to ekran pustki.
    for (const [navRows, oczekiwane] of [
      [0, 1],
      [1, 1],
      [3, 3],
      [30, 3],
      [Number.NaN, 1],
    ] as const) {
      const { container, unmount } = render(<HeaderSkeleton ticker={false} navRows={navRows} />);
      expect(container.querySelectorAll('[data-skeleton-band="nav"]')).toHaveLength(oczekiwane);
      unmount();
    }
  });
});

describe("HeaderSkeleton - dostępność placeholdera", () => {
  it("jest ukryty przed czytnikiem ekranu, bez tekstu i bez fokusu", () => {
    const { container } = render(
      <HeaderSkeleton alertBar ticker adBanner navRows={2} />,
    );
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
    expect(odczyt(qc)).toEqual({ alertBar: true, ticker: false, adBanner: true, navRows: 1 });
  });
});
