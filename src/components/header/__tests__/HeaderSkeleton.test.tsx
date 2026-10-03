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
 *  6. PUSTY PASEK = BEZ PASA. `TrendingTicker` zwraca `null` przy zerze
 *     wpisów, a szkielet rezerwował pas z samego `enabled` - nagłówek kurczył
 *     się po danych (przesunięcie odwrotne). Gdy wynik zapytania paska jest
 *     w cache'u, szkielet idzie za nim; klucz ma być TEN SAM, który zapisuje
 *     pasek - dowodzi tego test z prawdziwym `<TrendingTicker>`.
 *  7. PAS SZKIELETU = REZERWA PASKA dla każdej skórki (te same klasy
 *     wysokości), a nie zawsze geometria klasyczna.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n";
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
  type TickerBandSpec,
} from "@/components/header/HeaderSkeleton";
import {
  HEADER_TICKER_BAND_CLASS,
  HEADER_TICKER_BORDER_CLASS,
  HEADER_TICKER_CARDS_BAND_CLASSES,
  HEADER_TICKER_MARQUEE_BAND_CLASS,
  tickerBandGeometry,
} from "@/components/header/headerGeometry";
import { TickerHeightReserve, TrendingTicker } from "@/components/header/TrendingTicker";
import {
  LAYOUT_STYLES,
  LIVE_DIRECTIONS,
  resolveActiveTickerConfig,
  type LayoutStyle,
  type LiveDirection,
} from "@/lib/views/tickerVariants";
import type { TickerConfig } from "@/lib/views/headerTickerQuery";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import type { BuilderDocument } from "@/lib/builder/types";
import { signatureHeightPx, tickerHeightSignature } from "@/test/ticker/tickerGeometry";

// Granica sieci paska: pasek woła server functions przez `headerTickerQueryOptions`.
// Atrapa siedzi NA server functions, nie na opcjach zapytania - klucz ma być
// prawdziwy, bo to on jest przedmiotem testu „szkielet czyta wpis paska".
const tickerFeed = vi.hoisted(() => ({
  posts: [] as Array<{ id: string; slug: string; title_pl: string; title_en: string }>,
  calls: 0,
}));

vi.mock("@/lib/views/postViews.functions", () => ({
  getTrendingPosts: () => {
    tickerFeed.calls += 1;
    return Promise.resolve(tickerFeed.posts);
  },
  getTickerPosts: () => {
    tickerFeed.calls += 1;
    return Promise.resolve(tickerFeed.posts);
  },
}));

beforeEach(() => {
  tickerFeed.posts = [];
  tickerFeed.calls = 0;
});

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
      // Pas „na czasie" nie ma wysokości inline: dzieli KLASĘ wysokości
      // z samym paskiem danej skórki (patrz headerGeometry), więc liczymy jej
      // wartość nominalną z klas - niezależnie od `headerSkeletonHeight`.
      if (band.dataset.skeletonBand === "ticker")
        return total + signatureHeightPx(tickerHeightSignature(band));
      const inline = Number.parseFloat(band.style.height || "0");
      return total + (Number.isFinite(inline) && inline > 0 ? inline : 0);
    }, 0);
}

/** Każda skórka, a `glassLive` w obu kierunkach (to dwa różne silniki). */
type Skin = { layoutStyle: LayoutStyle; liveDirection: LiveDirection };
const SKINS: Skin[] = LAYOUT_STYLES.flatMap((layoutStyle): Skin[] =>
  layoutStyle === "glassLive"
    ? LIVE_DIRECTIONS.map((liveDirection) => ({ layoutStyle, liveDirection }))
    : [{ layoutStyle, liveDirection: "vertical" }],
);

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
    const signature = tickerHeightSignature(band);
    expect(signature.frame).toEqual([HEADER_TICKER_BORDER_CLASS]);
    expect(signature.band).toEqual([HEADER_TICKER_BAND_CLASS]);
  });

  it("REGRESJA 1 px: krawędź i `h-10` NIE siedzą na jednym elemencie", () => {
    // `box-sizing: border-box` (preflight Tailwinda) wlicza krawędź w `h-10`,
    // więc jeden div z obiema klasami miał 40 px, a pasek - ramka z krawędzią
    // wokół pasa `h-10` - ma 41 px. Szkielet powtarza teraz tę samą budowę.
    const { container } = render(<HeaderSkeleton ticker />);
    const frame = container.querySelector<HTMLElement>('[data-skeleton-band="ticker"]')!;
    expect(frame.classList.contains(HEADER_TICKER_BAND_CLASS)).toBe(false);
    expect(renderedHeight(container)).toBe(headerSkeletonHeight({ ticker: true }));
    expect(headerSkeletonHeight({ ticker: true, navRows: [] }) - HEADER_SKELETON_BANDS.navRow).toBe(
      HEADER_SKELETON_BANDS.ticker,
    );
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
      tickerBand: HEADER_SKELETON_DEFAULT_PROPS.tickerBand,
      adBanner: true,
      navRows: [HEADER_SKELETON_BANDS.navRow],
    });
  });
});

describe("pusty pasek „na czasie” nie dostaje pasa w szkielecie", () => {
  const settings = (trending: Record<string, unknown>) => ({ header: { trending } });
  const wpis = (id: string) => ({ id, slug: id, title_pl: `Wpis ${id}`, title_en: `Post ${id}` });

  it("włączony pasek + wynik w cache'u PUSTY = brak pasa (jak `null` paska)", () => {
    const props = headerSkeletonPropsFromSettings(settings({ enabled: true }), false, () => []);
    expect(props.ticker).toBe(false);
    expect(headerSkeletonHeight(props)).toBe(HEADER_SKELETON_BANDS.navRow);
  });

  it("włączony pasek + brak wpisu w cache'u (zimny start) = pas zostaje", () => {
    const props = headerSkeletonPropsFromSettings(
      settings({ enabled: true }),
      false,
      () => undefined,
    );
    expect(props.ticker).toBe(true);
    // Bez odczytu cache'u w ogóle (stare wołanie) - to samo.
    expect(headerSkeletonPropsFromSettings(settings({ enabled: true })).ticker).toBe(true);
  });

  it("włączony pasek + niepusty wynik w cache'u = pas zostaje", () => {
    const props = headerSkeletonPropsFromSettings(settings({ enabled: true }), false, () => [
      wpis("a"),
    ]);
    expect(props.ticker).toBe(true);
  });

  it("wyłączony pasek nie pyta cache'u wcale", () => {
    const peek = vi.fn(() => [wpis("a")]);
    const props = headerSkeletonPropsFromSettings(settings({ enabled: false }), false, peek);
    expect(props.ticker).toBe(false);
    expect(peek).not.toHaveBeenCalled();
  });

  it("odczyt dostaje AKTYWNĄ konfigurację paska (ta sama, którą dostaje pasek)", () => {
    const peek = vi.fn((_cfg: TickerConfig) => undefined);
    const trending = { source: "latest", days: 3, limit: 5 };
    headerSkeletonPropsFromSettings(settings(trending), false, peek);
    expect(peek).toHaveBeenCalledWith(resolveActiveTickerConfig(trending));
  });

  it("skórka i wiersze pionowej rotacji idą z ustawień i z liczby wpisów", () => {
    const glass = settings({ layoutStyle: "glassCards", visibleCount: 3 });
    // Wynik nieznany: pełne okno `visibleCount`.
    expect(headerSkeletonPropsFromSettings(glass, false, () => undefined).tickerBand).toEqual({
      layoutStyle: "glassCards",
      liveDirection: "vertical",
      rows: 3,
    });
    // Znane dwa wpisy: pasek pokaże dwa wiersze, nie trzy.
    expect(
      headerSkeletonPropsFromSettings(glass, false, () => [wpis("a"), wpis("b")]).tickerBand.rows,
    ).toBe(2);
  });

  function Probe() {
    const props = useHeaderSkeletonProps("all");
    return <span data-testid="szkielet">{JSON.stringify(props)}</span>;
  }

  it.each([
    ["zero wpisów", 0, false, 1],
    ["dwa wpisy", 2, true, 2],
  ])(
    "%s zapisane przez PRAWDZIWY pasek: szkielet czyta ten sam klucz",
    async (_nazwa, count, ticker, rows) => {
      // Konfiguracja inna niż domyślna w KAŻDYM polu klucza, które ma sens dla
      // źródła `latest` - rozjazd składania klucza między paskiem a szkieletem
      // dałby `undefined` (zimny start) i pas mimo pustego wyniku.
      const trending = {
        source: "latest",
        days: 3,
        limit: 5,
        layoutStyle: "glassCards",
        visibleCount: 3,
      };
      tickerFeed.posts = Array.from({ length: count }, (_, i) => wpis(`p${i + 1}`));
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      qc.setQueryData(siteSettingsQueryOptions.queryKey, settings(trending));
      const cfg = resolveActiveTickerConfig(trending);

      // Mapowanie konfiguracji na propsy - jak w `Header.tsx`.
      const view = render(
        <QueryClientProvider client={qc}>
          <TrendingTicker
            source={cfg.source ?? "trending"}
            mode={cfg.mode ?? "scroll"}
            layoutStyle={cfg.layoutStyle ?? "classic"}
            days={cfg.days ?? 7}
            limit={cfg.limit ?? 8}
            visibleCount={cfg.visibleCount ?? 1}
            liveDirection={cfg.liveDirection ?? "vertical"}
            pinnedPostId={cfg.pinnedPostId}
            pinnedUntil={cfg.pinnedUntil ?? null}
            selectedPostIds={cfg.selectedPostIds}
            mixedFill={cfg.mixedFill}
          />
        </QueryClientProvider>,
      );
      if (count === 0) await waitFor(() => expect(view.container).toBeEmptyDOMElement());
      else await screen.findByTestId("trending-ticker");
      expect(tickerFeed.calls).toBe(1);
      view.unmount();

      render(
        <QueryClientProvider client={qc}>
          <Probe />
        </QueryClientProvider>,
      );
      const props = JSON.parse(screen.getByTestId("szkielet").textContent!);
      expect(props.ticker).toBe(ticker);
      expect(props.tickerBand).toEqual({
        layoutStyle: "glassCards",
        liveDirection: "vertical",
        rows,
      });
      // Odczyt nie dołożył zapytania - nadal jedno pobranie, to z paska.
      expect(tickerFeed.calls).toBe(1);
    },
  );
});

describe("pas szkieletu = rezerwa paska, dla KAŻDEJ skórki", () => {
  it.each(SKINS)(
    "$layoutStyle ($liveDirection): te same klasy wysokości co `TickerHeightReserve`",
    ({ layoutStyle, liveDirection }) => {
      for (const rows of [1, 2, 5]) {
        const tickerBand: TickerBandSpec = { layoutStyle, liveDirection, rows };
        const skeleton = render(<HeaderSkeleton ticker tickerBand={tickerBand} />);
        const pas = tickerHeightSignature(
          skeleton.container.querySelector('[data-skeleton-band="ticker"]')!,
        );
        skeleton.unmount();

        const reserve = render(
          <TickerHeightReserve
            layoutStyle={layoutStyle}
            liveDirection={liveDirection}
            rows={rows}
          />,
        );
        const rezerwa = tickerHeightSignature(screen.getByTestId("trending-ticker-reserve"));
        reserve.unmount();

        expect(pas).toEqual(rezerwa);
        expect(pas.band).toEqual([
          tickerBandGeometry(layoutStyle, { liveDirection, rows }).bandClass,
        ]);
        // Kontrakt wysokości szkieletu liczy ten sam pas, który się renderuje.
        expect(headerSkeletonHeight({ ticker: true, tickerBand, navRows: [64] })).toBe(
          signatureHeightPx(pas) + 64,
        );
      }
    },
  );

  it("skórka szklana podnosi rezerwę ponad klasyczne 41 px", () => {
    const marquee = render(
      <HeaderSkeleton
        ticker
        tickerBand={{ layoutStyle: "glassMarquee", liveDirection: "vertical", rows: 1 }}
      />,
    );
    const band = marquee.container.querySelector('[data-skeleton-band="ticker"]')!;
    expect(tickerHeightSignature(band).band).toEqual([HEADER_TICKER_MARQUEE_BAND_CLASS]);
    expect(renderedHeight(marquee.container)).toBe(57 + HEADER_SKELETON_BANDS.navRow);
    marquee.unmount();

    const cards = render(
      <HeaderSkeleton
        ticker
        tickerBand={{ layoutStyle: "glassSpotlight", liveDirection: "vertical", rows: 2 }}
      />,
    );
    const cardsBand = cards.container.querySelector('[data-skeleton-band="ticker"]')!;
    expect(tickerHeightSignature(cardsBand).band).toEqual([HEADER_TICKER_CARDS_BAND_CLASSES[1]]);
    expect(renderedHeight(cards.container)).toBe(
      headerSkeletonHeight({
        ticker: true,
        tickerBand: { layoutStyle: "glassSpotlight", liveDirection: "vertical", rows: 2 },
      }),
    );
  });
});
