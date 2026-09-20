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
 * PARYTET SSR/KLIENT. Wysokości to stałe z tego modułu wstawiane inline, a
 * propsy wyprowadzamy z cache'a zapytań, który klient dziedziczy po serwerze
 * (dehydratacja) - pierwszy render po obu stronach daje identyczny HTML.
 */
import { useQueryClient } from "@tanstack/react-query";
import { resolveSetting, siteSettingsQueryOptions, type SettingsMap } from "@/lib/useSiteSetting";
import { resolveActiveTickerConfig } from "@/lib/views/tickerVariants";
import type { AdPageType } from "@/lib/ads/types";

export interface HeaderSkeletonProps {
  /** Pasek alertu (`theme_options.header.alert_bar`) jest włączony i ma treść. */
  alertBar?: boolean;
  /** Pasek „na czasie" (`header.trending.enabled !== false`). */
  ticker?: boolean;
  /** Strefa `header_banner` ma aktywny placement reklamowy. */
  adBanner?: boolean;
  /** Ile rzędów paska nawigacji zajmuje nagłówek (1-3). */
  navRows?: number;
}

/**
 * Wysokości pasów (px) POLICZONE Z KLAS realnych komponentów - jedno źródło
 * prawdy dla szkieletu i dla testów geometrii:
 *  - `alertBar` : `py-2` (16) + najwyższe dziecko (przycisk `p-1` + ikona 14 px
 *                 = 22) = 38, zaokrąglone w górę do 40;
 *  - `ticker`   : wewnętrzny pas `h-10` (40) + `border-b` (1) = 41;
 *  - `adBanner` : `DEFAULT_RESERVE_HEIGHT.header_banner` (90) - `py-2` mieści
 *                 się w `border-box`, więc nic nie dodajemy;
 *  - `navRow`   : `h-16` (64) - tyle ma mobilny pasek (`py-3` + `h-10`) i tyle
 *                 rezerwował dotychczasowy szkielet.
 * Przeszacowanie jest dopuszczalne (pusty pas nic nie przesuwa), niedoszacowanie
 * wraca jako CLS.
 */
export const HEADER_SKELETON_BANDS = {
  alertBar: 40,
  ticker: 41,
  adBanner: 90,
  navRow: 64,
} as const;

/**
 * Wariant używany, gdy o ustawieniach nie wiadomo NIC (pusty cache, zawieszona
 * granica Suspense): nawigacja + ticker, bo tak wygląda większość dokumentów.
 */
export const HEADER_SKELETON_DEFAULT_PROPS: Required<HeaderSkeletonProps> = {
  alertBar: false,
  ticker: true,
  adBanner: false,
  navRows: 1,
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

/** Ile pikseli rezerwuje szkielet o danej geometrii (kontrakt dla testów). */
export function headerSkeletonHeight(props: HeaderSkeletonProps = {}): number {
  const { alertBar, ticker, adBanner, navRows } = { ...HEADER_SKELETON_DEFAULT_PROPS, ...props };
  return (
    (alertBar ? HEADER_SKELETON_BANDS.alertBar : 0) +
    (ticker ? HEADER_SKELETON_BANDS.ticker : 0) +
    (adBanner ? HEADER_SKELETON_BANDS.adBanner : 0) +
    clampNavRows(navRows) * HEADER_SKELETON_BANDS.navRow
  );
}

function clampNavRows(navRows: number): number {
  return Math.max(1, Math.min(3, Math.round(navRows) || 1));
}

/**
 * Czysta funkcja: mapa ustawień -> geometria szkieletu. Bez mapy zwraca wariant
 * domyślny, więc wołający nigdy nie musi zgadywać.
 */
export function headerSkeletonPropsFromSettings(
  settings: SettingsMap | undefined,
  adBanner = false,
): Required<HeaderSkeletonProps> {
  if (!settings) return { ...HEADER_SKELETON_DEFAULT_PROPS, adBanner };
  const header = resolveSetting<{ trending?: unknown }>(settings, "header", {});
  const theme = resolveSetting<AlertBarSettings>(settings, "theme_options", {});
  const bar = theme.header?.alert_bar;
  return {
    // AlertBar zwraca `null` bez treści, więc sam `enabled` nie rezerwuje pasa.
    alertBar: Boolean(bar?.enabled) && (hasText(bar?.message_pl) || hasText(bar?.message_en)),
    ticker: resolveActiveTickerConfig(header.trending).enabled !== false,
    adBanner,
    navRows: 1,
  };
}

/**
 * Geometria szkieletu z tego, co już wiadomo w momencie renderu.
 *
 * Cache czytamy przez `getQueryData` - BEZ subskrypcji i BEZ fetcha: szkielet
 * pokazuje się dokładnie w zimnym starcie, więc nie wolno mu dokładać
 * round-tripu (placementy i tak pobiera `<AdZone>` w gałęzi z danymi).
 */
export function useHeaderSkeletonProps(adPageType: AdPageType = "all"): Required<HeaderSkeletonProps> {
  const queryClient = useQueryClient();
  const settings = queryClient.getQueryData<SettingsMap>(siteSettingsQueryOptions.queryKey);
  const placements = queryClient.getQueryData<unknown[]>(headerBannerQueryKey(adPageType));
  return headerSkeletonPropsFromSettings(
    settings,
    Array.isArray(placements) && placements.length > 0,
  );
}

export function HeaderSkeleton({
  alertBar = HEADER_SKELETON_DEFAULT_PROPS.alertBar,
  ticker = HEADER_SKELETON_DEFAULT_PROPS.ticker,
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
        <div
          data-skeleton-band="ticker"
          className="w-full border-b border-border bg-muted/40"
          style={{ height: HEADER_SKELETON_BANDS.ticker }}
        />
      )}
      {adBanner && (
        <div
          data-skeleton-band="ad-banner"
          className="w-full bg-muted/10"
          style={{ height: HEADER_SKELETON_BANDS.adBanner }}
        />
      )}
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          data-skeleton-band="nav"
          className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4"
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
