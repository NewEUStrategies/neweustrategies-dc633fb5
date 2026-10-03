/**
 * Layout-stable placeholder rendered while site_settings (header config) is
 * still loading. Matches the real header's vertical footprint so the page
 * below does not shift once data hydrates.
 *
 * DLACZEGO PASY, A NIE JEDNO `h-16`. Realny nagłówek to AlertBar +
 * TrendingTicker + AdZone `header_banner` + rząd(y) nawigacji, więc stałe
 * 64 px zaniżały go nawet o ~180 px (komentarz w `__root.tsx`), a gałąź
 * `return null` w `Header.tsx` rezerwowała 0 px. Szkielet dostaje więc geometrię
 * z ustawień i składa dokładnie te pasy, które nagłówek naprawdę pokaże.
 *
 * DLACZEGO RZĘDY LICZYMY Z DOKUMENTU, A NIE STAŁĄ. Do 2026-09-21 mapowanie
 * ustawień zwracało zawsze `navRows: 1`, czyli JEDEN pas `h-16`. Na artefakcie
 * produkcyjnym (fixture `first-visit`, 1280 px) szkielet trzymał 101 px wobec
 * 186 px realnego nagłówka - 85 px niedoboru, które po podmianie szkieletu na
 * nagłówek spychało całe `<main>` w dół (CLS 0,13 w „first visit pl, cold"
 * przy progu 0,1). Nagłówek jest dokumentem buildera i siedzi w tych samych
 * `site_settings`, które szkielet już czyta, więc rezerwę liczymy wprost
 * z niego (`estimateChromeRowHeights`). Dziś: rezerwa 184 px wobec 185 px
 * realnego nagłówka.
 *
 * DLACZEGO TA LICZBA W OGÓLE TRZYMA. Rezerwa zakłada, że kolumna kompaktowych
 * widgetów to JEDEN rząd - i `RenderColumn` egzekwuje to `flex-nowrap`em
 * (`BuilderRenderer.tsx`). Dopóki pasek narzędzi mógł się zawinąć, ta sama
 * konfiguracja dawała 88 px rzędu lokalnie i 124 px na runnerze CI (inny
 * fallback kroju = szerszy tekst), więc rezerwa liczona z konfiguracji nie
 * miała szans trafić w oba środowiska naraz.
 *
 * DLACZEGO OSOBNO MOBILE I DESKTOP. `Header.tsx` renderuje pasek mobilny pod
 * `lg:hidden`, a header builderowy pod `hidden lg:block`. Jedna wspólna
 * rezerwa musiałaby być błędna po jednej ze stron progu, więc szkielet
 * powtarza dokładnie te same bramki.
 *
 * PARYTET SSR/KLIENT. Wysokości to stałe z tego modułu (albo liczba z
 * dokumentu) wstawiane inline, a propsy wyprowadzamy z cache'a zapytań, który
 * klient dziedziczy po serwerze (dehydratacja) - pierwszy render po obu
 * stronach daje identyczny HTML.
 */
import { useQueryClient } from "@tanstack/react-query";
import { resolveSetting, siteSettingsQueryOptions, type SettingsMap } from "@/lib/useSiteSetting";
import {
  resolveActiveTickerConfig,
  type LayoutStyle,
  type LiveDirection,
} from "@/lib/views/tickerVariants";
import { peekHeaderTickerPosts, type TickerConfig } from "@/lib/views/headerTickerQuery";
import { estimateChromeRowHeights } from "@/lib/builder/sectionHeightEstimate";
import {
  HEADER_MOBILE_BAR_BOX_CLASS,
  HEADER_MOBILE_BAR_CONTENT_CLASS,
  HEADER_TICKER_BORDER_CLASS,
  tickerBandGeometry,
  tickerCardRows,
  tickerPerView,
} from "@/components/header/headerGeometry";
import type { BuilderDocument } from "@/lib/builder/types";
import type { AdPageType } from "@/lib/ads/types";

/** Skórka paska „na czasie", z której pas szkieletu bierze geometrię. */
export interface TickerBandSpec {
  layoutStyle: LayoutStyle;
  liveDirection: LiveDirection;
  /** Wiersze pionowej rotacji (`tickerCardRows`); pozostałe skórki go ignorują. */
  rows: number;
}

export interface HeaderSkeletonProps {
  /** Pasek alertu (`theme_options.header.alert_bar`) jest włączony i ma treść. */
  alertBar?: boolean;
  /**
   * Pasek „na czasie" zajmie miejsce: włączony w ustawieniach i - jeśli wynik
   * zapytania jest już w cache'u - z co najmniej jednym wpisem.
   */
  ticker?: boolean;
  /** Skórka paska - wysokość pasa zależy od niej (`tickerBandGeometry`). */
  tickerBand?: TickerBandSpec;
  /** Strefa `header_banner` ma aktywny placement reklamowy. */
  adBanner?: boolean;
  /**
   * Wysokości (px) kolejnych rzędów headera builderowego - jedna liczba na
   * sekcję dokumentu, w kolejności renderu. Widoczne dopiero od `lg`, tak samo
   * jak sam header builderowy.
   */
  navRows?: readonly number[];
}

/**
 * Wysokości pasów (px) POLICZONE Z KLAS realnych komponentów - jedno źródło
 * prawdy dla szkieletu i dla testów geometrii:
 *  - `alertBar` : `py-2` (16) + najwyższe dziecko (przycisk `p-1` + ikona 14 px
 *                 = 22) = 38, zaokrąglone w górę do 40;
 *  - `ticker`   : skórka klasyczna - wewnętrzny pas `h-10` (2,5 rem = 40 px
 *                 przy 16 px root) + `border-b` (1) = 41. Szkielet renderuje
 *                 TĘ SAMĄ ramkę i klasę wysokości, co `TrendingTicker`
 *                 (`tickerBandGeometry`), więc parytet trzyma się także przy
 *                 płynnym `root font-size` (repo skaluje go między 1280 a
 *                 1920 px, gdzie 1 rem = 15 px); liczba jest tu wartością
 *                 NOMINALNĄ dla testów, a skórki szklane mają własną
 *                 (`tickerBandGeometry(...).nominalPx`);
 *  - `adBanner` : `DEFAULT_RESERVE_HEIGHT.header_banner` (90) - `py-2` mieści
 *                 się w `border-box`, więc nic nie dodajemy;
 *  - `navRow`   : awaryjny rząd nagłówka, gdy dokument buildera jest nieznany
 *                 (`h-16` = 64) - realne rzędy liczy `estimateChromeRowHeights`.
 * Niedoszacowanie wraca jako CLS, ale przeszacowanie TAK SAMO: szkielet jest
 * malowany, a potem podmieniany na nagłówek, więc każdy piksel różnicy
 * przesuwa stronę - w którąkolwiek stronę.
 */
export const HEADER_SKELETON_BANDS = {
  alertBar: 40,
  // Z tej samej mapy co pasek i jego rezerwa - druga, ręczna kopia klasycznej
  // geometrii mogłaby się po cichu rozjechać z `tickerBandGeometry`.
  ticker: tickerBandGeometry("classic").nominalPx,
  adBanner: 90,
  navRow: 64,
} as const;

/** Najniższy/najwyższy sensowny rząd nagłówka (px) - strażnik śmieci z bazy. */
export const HEADER_SKELETON_ROW_MIN_PX = 24;
export const HEADER_SKELETON_ROW_MAX_PX = 240;
/**
 * Sufit całej rezerwy rzędów. Nagłówek dłuższy niż ~2 ekrany telefonu to albo
 * błąd w danych, albo dokument, którego i tak nie da się sensownie zgadnąć -
 * pusty ekran kosztuje wtedy więcej niż przesunięcie.
 */
export const HEADER_SKELETON_NAV_MAX_PX = 400;

/**
 * Wariant używany, gdy o ustawieniach nie wiadomo NIC (pusty cache, zawieszona
 * granica Suspense): nawigacja + ticker, bo tak wygląda większość dokumentów.
 */
export const HEADER_SKELETON_DEFAULT_PROPS: Required<HeaderSkeletonProps> = {
  alertBar: false,
  ticker: true,
  tickerBand: { layoutStyle: "classic", liveDirection: "vertical", rows: 1 },
  adBanner: false,
  navRows: [HEADER_SKELETON_BANDS.navRow],
};

/** Klucz zapytania o placementy strefy nagłówka - ten sam, co czyta `<AdZone>`. */
function headerBannerQueryKey(adPageType: AdPageType) {
  return ["ad_placements", "header_banner", adPageType, null] as const;
}

type AlertBarSettings = {
  header?: {
    alert_bar?: { enabled?: boolean; message_pl?: string; message_en?: string };
  };
};

const hasText = (value: string | undefined): boolean => (value ?? "").trim().length > 0;

/** Ile pikseli rezerwuje szkielet o danej geometrii NA DESKTOPIE (kontrakt dla testów). */
export function headerSkeletonHeight(props: HeaderSkeletonProps = {}): number {
  const { alertBar, ticker, tickerBand, adBanner, navRows } = {
    ...HEADER_SKELETON_DEFAULT_PROPS,
    ...props,
  };
  return (
    (alertBar ? HEADER_SKELETON_BANDS.alertBar : 0) +
    (ticker ? tickerBandGeometryFor(tickerBand).nominalPx : 0) +
    (adBanner ? HEADER_SKELETON_BANDS.adBanner : 0) +
    clampNavRows(navRows).reduce((total, row) => total + row, 0)
  );
}

/**
 * Rzędy nagłówka przycięte do sensownych widełek. Pusta lista (brak dokumentu,
 * same ukryte sekcje) schodzi do jednego awaryjnego rzędu - zero rezerwy to
 * najgorszy możliwy wynik, bo wtedy cały nagłówek doskakuje po hydratacji.
 */
export function clampNavRows(navRows: readonly number[] | undefined): number[] {
  const rows: number[] = [];
  let total = 0;
  for (const raw of Array.isArray(navRows) ? navRows : []) {
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const row = Math.min(
      HEADER_SKELETON_ROW_MAX_PX,
      Math.max(HEADER_SKELETON_ROW_MIN_PX, Math.round(raw)),
    );
    if (total + row > HEADER_SKELETON_NAV_MAX_PX) break;
    rows.push(row);
    total += row;
  }
  return rows.length > 0 ? rows : [HEADER_SKELETON_BANDS.navRow];
}

type HeaderChromeSettings = {
  trending?: unknown;
  builder_data?: BuilderDocument | null;
};

/** Geometria pasa „na czasie" ze specyfikacji skórki - wspólna z paskiem. */
function tickerBandGeometryFor(spec: TickerBandSpec) {
  return tickerBandGeometry(spec.layoutStyle, {
    liveDirection: spec.liveDirection,
    rows: spec.rows,
  });
}

/**
 * Odczyt wpisów paska z cache'a dla danej konfiguracji: `undefined` = wynik
 * nieznany, tablica = wynik znany (także pusty).
 */
export type TickerPostsPeek = (cfg: TickerConfig) => readonly unknown[] | undefined;

/**
 * Czysta funkcja: mapa ustawień -> geometria szkieletu. Bez mapy zwraca wariant
 * domyślny, więc wołający nigdy nie musi zgadywać.
 *
 * PUSTY PASEK NIE DOSTAJE PASA. `TrendingTicker` zwraca `null`, gdy zapytanie
 * wróci bez wpisów - rezerwa liczona z samego `enabled` trzymała wtedy 41+ px,
 * które po podmianie szkieletu na nagłówek ZNIKAŁY (przesunięcie w górę, czyli
 * odwrotne do zwykłego CLS-u, ale liczone tak samo). Gdy wynik jest już
 * w cache'u (`peekTickerPosts`), szkielet idzie za nim: zero wpisów = zero pasa,
 * N wpisów = tyle wierszy pionowej rotacji, ile pasek naprawdę pokaże.
 *
 * Czego się NIE da: zimny start bez wpisu w cache'u (pierwsze wejście, gdy
 * rozgrzewka loadera nie zdążyła albo zapytanie jest w locie). Wtedy wynik jest
 * nieznany i szkielet trzyma pas skórki z pełnym oknem - pasek, który okaże się
 * pusty, nadal zwinie się o ten pas. To świadomy wybór: bez rezerwy niepusty
 * pasek (przypadek typowy) doskoczyłby o ten sam pas w dół - z tą samą wagą
 * w CLS, a znacznie częściej.
 */
export function headerSkeletonPropsFromSettings(
  settings: SettingsMap | undefined,
  adBanner = false,
  peekTickerPosts?: TickerPostsPeek,
): Required<HeaderSkeletonProps> {
  if (!settings) return { ...HEADER_SKELETON_DEFAULT_PROPS, adBanner };
  const header = resolveSetting<HeaderChromeSettings>(settings, "header", {});
  const theme = resolveSetting<AlertBarSettings>(settings, "theme_options", {});
  const bar = theme.header?.alert_bar;
  const trending = resolveActiveTickerConfig(header.trending);
  const enabled = trending.enabled !== false;
  const cached = enabled ? peekTickerPosts?.(trending) : undefined;
  const known = Array.isArray(cached) ? cached : undefined;
  return {
    // AlertBar zwraca `null` bez treści, więc sam `enabled` nie rezerwuje pasa.
    alertBar: Boolean(bar?.enabled) && (hasText(bar?.message_pl) || hasText(bar?.message_en)),
    ticker: enabled && (known === undefined || known.length > 0),
    tickerBand: {
      layoutStyle: trending.layoutStyle ?? "classic",
      liveDirection: trending.liveDirection ?? "vertical",
      rows: tickerCardRows(tickerPerView(trending.visibleCount), known?.length),
    },
    adBanner,
    // Ten sam dokument, który `HeaderInner` podaje `BuilderRenderer`owi - więc
    // rezerwa i realny nagłówek mają JEDNO źródło geometrii.
    navRows: clampNavRows(estimateChromeRowHeights(header.builder_data)),
  };
}

/**
 * Geometria szkieletu z tego, co już wiadomo w momencie renderu.
 *
 * Cache czytamy przez `getQueryData` - BEZ subskrypcji i BEZ fetcha: szkielet
 * pokazuje się dokładnie w zimnym starcie, więc nie wolno mu dokładać
 * round-tripu (placementy i tak pobiera `<AdZone>` w gałęzi z danymi, wpisy
 * paska - `<TrendingTicker>`). Wpisy paska czytamy przez
 * `peekHeaderTickerPosts`, czyli kluczem z tej samej `headerTickerQueryOptions`,
 * którą woła pasek i loader korzenia.
 */
export function useHeaderSkeletonProps(
  adPageType: AdPageType = "all",
): Required<HeaderSkeletonProps> {
  const queryClient = useQueryClient();
  const settings = queryClient.getQueryData<SettingsMap>(siteSettingsQueryOptions.queryKey);
  const placements = queryClient.getQueryData<unknown[]>(headerBannerQueryKey(adPageType));
  return headerSkeletonPropsFromSettings(
    settings,
    Array.isArray(placements) && placements.length > 0,
    (cfg) => peekHeaderTickerPosts(queryClient, cfg),
  );
}

export function HeaderSkeleton({
  alertBar = HEADER_SKELETON_DEFAULT_PROPS.alertBar,
  ticker = HEADER_SKELETON_DEFAULT_PROPS.ticker,
  tickerBand = HEADER_SKELETON_DEFAULT_PROPS.tickerBand,
  adBanner = HEADER_SKELETON_DEFAULT_PROPS.adBanner,
  navRows = HEADER_SKELETON_DEFAULT_PROPS.navRows,
}: HeaderSkeletonProps = {}) {
  const rows = clampNavRows(navRows);
  return (
    <div className="bg-background" aria-hidden="true" data-skeleton="header">
      {alertBar && (
        <div
          data-skeleton-band="alert-bar"
          className="w-full bg-muted animate-pulse"
          style={{ height: HEADER_SKELETON_BANDS.alertBar }}
        />
      )}
      {ticker && (
        // Bez wysokości inline: ta sama krawędź na ramce i ta sama klasa
        // wysokości na pasie WEWNĄTRZ niej, co w pudełku paska „na czasie"
        // danej skórki, więc oba boksy skalują się identycznie z `root
        // font-size`. Dwa elementy, nie jeden: przy `box-sizing: border-box`
        // `h-10` i `border-b` na jednym divie dawały 40 px zamiast 41 px paska
        // (krawędź wliczała się w wysokość zamiast dokładać się do niej).
        // Bez `cms-trending`: tę klasę mierzy `Header.tsx` i ściska `styles.css`.
        <div
          data-skeleton-band="ticker"
          data-tt-layout={tickerBand.layoutStyle}
          className={`w-full border-border bg-muted/40 ${HEADER_TICKER_BORDER_CLASS}`}
        >
          <div data-tt-band="" className={tickerBandGeometryFor(tickerBand).bandClass} />
        </div>
      )}
      {adBanner && (
        <div
          data-skeleton-band="ad-banner"
          className="w-full bg-muted/10"
          style={{ height: HEADER_SKELETON_BANDS.adBanner }}
        />
      )}
      {/* Pasek mobilny - te same klasy pudełka, co `Header.tsx` pod `lg:hidden`. */}
      <div data-skeleton-band="nav-mobile" className={`lg:hidden ${HEADER_MOBILE_BAR_BOX_CLASS}`}>
        <div className={`${HEADER_MOBILE_BAR_CONTENT_CLASS} flex items-center justify-between`}>
          <div className="h-7 w-32 rounded-md bg-muted animate-pulse" />
          <div className="h-8 w-8 rounded-md bg-muted animate-pulse" />
        </div>
      </div>
      {/* Header builderowy - widoczny od `lg`, dokładnie jak w `Header.tsx`. */}
      {rows.map((height, row) => (
        <div
          key={row}
          data-skeleton-band="nav"
          className="hidden lg:flex mx-auto max-w-7xl items-center justify-between px-4"
          style={{ height }}
        >
          <div className="h-7 w-32 rounded-md bg-muted animate-pulse" />
          <nav className="hidden items-center gap-6 md:flex">
            <div className="h-4 w-14 rounded bg-muted animate-pulse" />
            <div className="h-4 w-16 rounded bg-muted animate-pulse" />
            <div className="h-4 w-12 rounded bg-muted animate-pulse" />
            <div className="h-4 w-20 rounded bg-muted animate-pulse" />
          </nav>
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
            <div className="h-8 w-20 rounded-md bg-muted animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
