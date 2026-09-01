import { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useMemo, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import appCss from "../styles.css?url";
// Fingerprinted by Vite to the SAME emitted file the @font-face in styles.css
// references, so the preload is reused (not a second download). See styles.css.
import redHatDisplayLatin from "../assets/fonts/red-hat-display-latin.woff2?url";
import redHatDisplayLatinExt from "../assets/fonts/red-hat-display-latin-ext.woff2?url";
import { appendLinkHeader } from "../lib/http/responseHeaders";
import { buildRootHead } from "../lib/seo/meta";
import {
  dictionaryPreloadLinkHeaderValue,
  rootDocumentLinks,
  rootLinkHeaderValues,
  type RootAssets,
} from "../lib/seo/rootHead";
import { LOCALE_CHUNK_URLS } from "../lib/seo/localeChunks";
import { showsSiteChrome } from "../lib/routing/siteChrome";
import { THEME_INIT_SCRIPT } from "../lib/theme/themeInitScript";
import { BOOT_PROBE_SCRIPT } from "../lib/observability/bootProbeScript";
import { markAppReady } from "../lib/watchdog/appReady";
import { speculationRulesJson } from "../lib/seo/speculationRules";
import { afterPrerendering } from "../lib/prerender";
import { getOrigin } from "../lib/seo/request";
import { enforceCanonicalHost } from "../lib/http/canonicalRedirect";
import { reportPlatformError } from "../lib/platform-error-reporting";
import { syncI18nToRequest, getRenderI18n } from "../lib/i18n";
import { supabasePublicConfigScript } from "../lib/supabasePublicConfig";
import { currentLang } from "../lib/i18n/localeRuntime";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import { FriendlyErrorPage } from "../components/error/FriendlyErrorPage";
import { ThemeProvider } from "../components/ThemeProvider";
import { AuthProvider } from "../hooks/useAuth";
import { IconPackSync } from "../components/IconPackSync";
import { DesignTokensStyle } from "../components/DesignTokensStyle";
import { ContentAreaStyle } from "../components/ContentAreaStyle";
import { postLayoutSettingsQueryOptions } from "../hooks/usePostLayoutSettings";
import { defaultPostLayoutSettings } from "../lib/postLayouts";
import { ThemeOptionsStyle } from "../components/ThemeOptionsStyle";
import { ThemeDesignStyle } from "../components/theme/ThemeDesignStyle";
import { ThemeFontSizesStyle } from "../components/theme/ThemeFontSizesStyle";
import { ConsentScriptInjector } from "../components/ConsentScriptInjector";
import { useEffectiveConsent } from "../lib/ads/consent";
import { whenIdle } from "../lib/ads/idle";

import { ErrorBoundary } from "../components/ErrorBoundary";
import { WidgetLiveSync } from "../lib/builder/widgetCacheInvalidation";
import { SiteSettingsLiveSync } from "../lib/builder/siteSettingsLiveSync";
import { CohesionLiveSync } from "../lib/realtime/cohesionLiveSync";
import { resolveSetting, siteSettingsQueryOptions } from "../lib/useSiteSetting";
import { parseSeoSettings, SEO_SETTINGS_KEY } from "../lib/seo/settings";
import { rememberSocialDefaults } from "../lib/seo/socialDefaults";
import { rememberBrandDefaults } from "../lib/seo/brandDefaults";
import { headerTickerQueryOptions } from "../lib/views/headerTickerQuery";
import { resolveActiveTickerConfig } from "../lib/views/tickerVariants";
import { designTokensQueryOptions } from "../lib/builder/designTokens";
import { globalColorsQueryOptions } from "../hooks/useGlobalColors";
import { EMPTY_GLOBAL_COLORS } from "../lib/builder/globalColors";
import type { HeaderSettings } from "../components/Header";
import type { BuilderDocument } from "../lib/builder/types";
import { defaultDocFor } from "../lib/builder/chromeDefaults";
import { prefetchCachedRouteQueries } from "../lib/builder/prefetch";
import { SiteChrome } from "../components/SiteChrome";
import { GlobalAudioPlayerProvider, useGlobalAudioPlayer } from "../lib/audio/global-player";
import { UnsavedChangesGuardHost } from "../components/UnsavedChangesGuardHost";
import { AppDialogHost } from "../components/AppDialogHost";
import { EMPTY_TOKENS } from "../lib/builder/designTokens";
import { withBudget } from "../lib/asyncBudget";

export const ROOT_WARM_BUDGET_MS = 2_500;

/**
 * Twardy sufit DRUGIEJ fali (dekoracja chrome'u: ticker, menu, widgety headera
 * i stopki). Do 2026-09-01 fala 2 miała ten sam budżet co fala 1, a startuje
 * dopiero po jej rozstrzygnięciu (potrzebuje ustawień), więc sam korzeń mógł
 * trzymać dokument 2 × 2 500 = 5 000 ms BEZ JEDNEGO BAJTU HTML-a - na KAŻDEJ
 * trasie publicznej. Strażnik strumienia dokumentu tego okna nie mierzy: liczy
 * czas od utworzenia strumienia, a tu jesteśmy jeszcze przed renderem
 * (framework awaituje wszystkie loadery, patrz createStartHandler).
 *
 * DLACZEGO 500 ms, a NIE „nie awaituj wcale": `router.options.dehydrate`
 * (src/router.tsx:142) woła `sweepQueryCacheForSerialization` PRZED renderem
 * Reacta, a ten anuluje (`revert: true`) i usuwa każde zapytanie, które nie
 * zdążyło się rozstrzygnąć. Rozgrzewka „fire-and-forget" nie dowozi więc
 * NICZEGO: ticker renderuje null, menu maluje szkielet - dokładnie te dwie
 * regresje, które opisują komentarze niżej (ticker = najgorszy CLS serwisu,
 * menu = „Menu jest puste..." mimo skonfigurowanego menu). Krótki, ale
 * awaitowany budżet zachowuje dowóz w stanie ustalonym (wszystkie odnogi stoją
 * za `edgeTtlCache`, 60 s TTL per host najemcy) i ogranicza koszt zimnego
 * renderu do pół sekundy zamiast dwóch i pół.
 */
export const CHROME_WARM_BUDGET_MS = 500;

// Nakładki (popupy, paleta komend, pasek audio) nie są potrzebne do pierwszego
// malowania ŻADNEJ strony - React.lazy trzyma je poza bundlem wejściowym
// (wcześniej ładowały się na każdej stronie: cmdk, formularz newslettera z
// rendererem dokumentów, formularz logowania...). Fallback null = zero CLS,
// bo wszystkie renderują się jako overlaye/portale poza przepływem dokumentu.
const LoginPopup = lazy(() =>
  import("../components/LoginPopup").then((m) => ({ default: m.LoginPopup })),
);
const NewsletterPopup = lazy(() =>
  import("../components/NewsletterPopup").then((m) => ({ default: m.NewsletterPopup })),
);
const CommandPalette = lazy(() =>
  import("../components/search/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
const PopupHost = lazy(() =>
  import("../components/popups/PopupHost").then((m) => ({ default: m.PopupHost })),
);
const GlobalAudioBar = lazy(() =>
  import("../components/audio/GlobalAudioBar").then((m) => ({ default: m.GlobalAudioBar })),
);
// Dialog "zapytaj eksperta" otwiera się WYŁĄCZNIE zdarzeniem busa
// (expertRequestDialogBus) - statyczny import ciągnął 347-liniowy formularz
// (zod + FloatingInput + hooki quota) i pełne słowniki PL+EN do chunku
// wejściowego każdej strony, mimo że Suspense wokół hosta już istniał.
// UWAGA: host musi być zamontowany od pierwszego renderu (bus nie ma replay
// ostatniego zdarzenia) - lazy tylko wydziela chunk, nie odracza montażu.
const ExpertRequestDialogHost = lazy(() =>
  import("../components/chat/ExpertRequestDialogHost").then((m) => ({
    default: m.ExpertRequestDialogHost,
  })),
);
// Baner zgód renderuje null zarówno w SSR, jak i w pierwszym renderze klienta
// (`mounted` przestawia się dopiero w useEffect), więc React.lazy nie zmienia
// tu ANI JEDNEGO bajtu HTML-a - a wynosi ~1400 linii źródeł (banner 859 +
// cookieBanner/config 170 + registry 402) poza chunk wejściowy. Musi pozostać
// zamontowany bezwarunkowo: jego efekty są jedynym pisarzem
// setMarketingConsent/setConsentOverlayVisible w overlayCoordinator - bramka
// "tylko dopóki nie zdecydowano" odblokowałaby popupy marketingowe u osób,
// które marketing odrzuciły.
const ConsentBanner = lazy(() =>
  import("../components/ConsentBanner").then((m) => ({ default: m.ConsentBanner })),
);
// Panel podglądu zgód (aktywny tylko przy ?consent-preview=1) - ta sama
// doktryna lazy-overlay co wyżej.
const ConsentPreviewPanel = lazy(() =>
  import("../components/ConsentPreviewPanel").then((m) => ({ default: m.ConsentPreviewPanel })),
);
// Toaster (sonner) - overlay jak wyżej: renderuje wyłącznie skutki interakcji
// (toasty mutacji), nigdy pierwszego malowania, a statyczny import trzymał
// całą bibliotekę sonner (~63 kB źródeł) w chunku wejściowym. Moduły ścieżki
// bootowania wołają toasty przez leniwy most lib/notify.ts (kolejka FIFO do
// czasu załadowania chunku), więc semantyka wywołań nie zmienia się.
// Świadomy kompromis: toast wystrzelony między hydratacją a montażem chunku
// przepada (sonner nie odtwarza historii subskrybentom) - realny nadawca
// (mutacje operatora) nie kończy się przed hydratacją.
const Toaster = lazy(() => import("../components/ui/sonner").then((m) => ({ default: m.Toaster })));

// Pasek audio montuje się (i dociąga swój chunk) dopiero, gdy odtwarzacz ma
// track albo zgłosił błąd (toast o nieudanym TTS mieszka w GlobalAudioBar).
// Wcześniej sam bar + zależności siedziały w bundlu każdej strony, mimo że
// bez aktywnego audio renderował null.
function GlobalAudioBarGate() {
  const player = useGlobalAudioPlayer();
  if (!player.track && player.status !== "error") return null;
  return (
    <Suspense fallback={null}>
      <GlobalAudioBar />
    </Suspense>
  );
}

function NotFoundComponent() {
  // Jedno źródło wyglądu 404 - ten sam ekran co w trasach dynamicznych.
  return <PublicNotFound />;
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  useEffect(() => {
    reportPlatformError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return <FriendlyErrorPage error={error} reset={reset} />;
}

function RouteLoadingSkeleton() {
  // Delayed fade-in (opacity 0 -> 1 after 180ms) sprawia, że krótkie
  // przejścia (<200ms, gdy trasa jest już preloadowana) nie migają
  // szkieletem - użytkownik widzi tylko płynny cross-fade View Transitions,
  // a shimmer pojawia się dopiero przy naprawdę wolnych ładowaniach.
  return (
    <div
      className="min-h-[55vh] w-full px-4 py-8 lg:px-8 animate-[route-skeleton-in_260ms_ease-out_140ms_both]"
      aria-busy="true"
    >
      <div className="mx-auto max-w-[1200px] space-y-6">
        <div className="skeleton-shimmer h-5 w-40 rounded" />
        <div className="skeleton-shimmer h-10 w-2/3 max-w-2xl rounded" />
        <div className="grid gap-5 md:grid-cols-3">
          <div className="md:col-span-2 space-y-4">
            <div className="skeleton-shimmer aspect-[16/7] rounded-xl" />
            <div className="skeleton-shimmer h-4 w-full rounded" />
            <div className="skeleton-shimmer h-4 w-5/6 rounded" />
          </div>
          <div className="space-y-3">
            <div className="skeleton-shimmer h-24 rounded-xl" />
            <div className="skeleton-shimmer h-24 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * URL-e zasobów krytycznych rozwiązane przez bundler (`?url`). Jeden obiekt dla
 * `<head>` i dla nagłówka HTTP `Link` - gdyby były dwa, mogłyby się rozjechać.
 */
const ROOT_ASSETS: RootAssets = {
  appCss,
  fontLatin: redHatDisplayLatin,
  fontLatinExt: redHatDisplayLatinExt,
};

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => {
    // One language source for the whole document head, matching the <html lang>
    // RootShell emits. Both read the request-scoped currentLang() (NOT the
    // module-global i18next singleton, which is shared across concurrent SSR
    // requests and would race), so the branded meta, the font preload and the
    // <html lang> are always derived from this request's URL and never disagree
    // - even under concurrent multi-language SSR sharing one worker.
    const lang = currentLang();
    return {
      // Branded New European Strategies defaults (PL/EN). Any route without its
      // own head() - error pages, parts of the admin, fallbacks - and the first
      // social-share preview inherit these instead of the generator defaults.
      meta: [
        // Mobile viewport is declared directly in the root route so every page
        // (including error/fallback renders) carries it, even when a child route
        // overrides the rest of the meta stack.
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        ...buildRootHead(lang, getOrigin()),
      ],
      // Red Hat Display is self-hosted via @font-face in styles.css (see there),
      // so no Google Fonts stylesheet / preconnect is needed - one fewer
      // render-blocking third-party request, and no visitor IPs sent to Google.
      // Zestaw `<link>` korzenia (arkusz, favicon, preload fontów, rozgrzanie
      // połączenia do hosta obrazów, autodiscovery feedów) żyje w
      // `lib/seo/rootHead.ts` RAZEM z wartościami nagłówka HTTP `Link` niżej -
      // oba opisują ten sam plan pobierania i muszą mówić to samo.
      links: rootDocumentLinks(lang, getOrigin(), ROOT_ASSETS),
      // Speculation Rules API: natywny prefetch (hover) publicznych nawigacji;
      // powierzchnie zalogowane i transakcyjne wykluczone (wspólna lista z NES
      // Edge Cache). Prerender świadomie pominięty - AppLink przechwytuje
      // nawigacje SPA, więc prerenderowany dokument nigdy nie byłby
      // konsumowany (szczegóły w speculationRules.ts). Beacony i tak są
      // osłonięte przed prerenderem w src/lib/prerender.ts.
      scripts: [{ type: "speculationrules", children: speculationRulesJson() }],
    };
  },
  // Prefetch the entire site_settings bulk map on the server. The same query
  // backs Header, Footer, navigation menus, AlertBar and CopyrightBar - one
  // round-trip on the edge hydrates every layout chunk so chrome renders
  // in lockstep with the route body instead of popping in after hydration.
  loader: async ({ context, location }) => {
    // 301 legacy/preview hosts of the hosting layer (see canonicalRedirect.ts)
    // to https://neweuropeanstrategies.com preserving path + query. Runs
    // server-side only; editor preview (id-preview--*, EDITOR_HOST_SUFFIXES) and
    // localhost are excluded so the builder iframe keeps working.
    enforceCanonicalHost();
    await syncI18nToRequest().catch(() => undefined);
    // Krytyczne zasoby także jako nagłówek HTTP `Link` (obok <link> w <head>):
    // przeglądarka startuje pobieranie CSS i fontów z nagłówków odpowiedzi,
    // zanim sparsuje pierwszy bajt HTML, a NES Edge Cache utrwala nagłówek na
    // HIT/STALE - to fundament pod 103 Early Hints na Cloudflare. Zestaw jest
    // per-język (latin-ext tylko dla PL), a dokumenty są keyowane ścieżką
    // z prefiksem języka, więc wpis cache nigdy nie niesie cudzych hintów.
    const renderLang = currentLang();
    for (const value of rootLinkHeaderValues(renderLang, ROOT_ASSETS)) {
      appendLinkHeader(value);
    }
    // Chunk rdzenia SŁOWNIKA aktywnego języka - WYŁĄCZNIE nagłówkiem, nigdy
    // `<link>`-iem w `<head>`. Nazwa pliku jest znana tylko w środowisku
    // serwerowym (bundel przeglądarki wczytuje moduł wirtualny, zanim chunki
    // dostaną nazwy), więc węzeł w `<head>` byłby rozjazdem tożsamości korzenia
    // dokumentu. Pełne uzasadnienie: `lib/seo/rootHead.ts` przy
    // `dictionaryPreloadLinkHeaderValue` i nagłówek
    // `scripts/lib/localeChunkPlugin.ts`.
    const dictionaryHint = dictionaryPreloadLinkHeaderValue(LOCALE_CHUNK_URLS[renderLang]);
    if (dictionaryHint) appendLinkHeader(dictionaryHint);
    // Warm site_settings + design tokens / global colors / post-layout so
    // <DesignTokensStyle />, <ContentAreaStyle /> and friends render their
    // `<style>` server-side. Without this the first paint uses raw styles.css
    // defaults (dark navy fallback) and only switches to the tenant palette
    // after client-side hydration - a jarring flash of unstyled theme.
    //
    // CRITICAL: this loader runs on EVERY route, so it MUST NOT be a single
    // point of total failure. These are all presentation-layer caches with
    // built-in defaults (resolveSetting / EMPTY_TOKENS / EMPTY_GLOBAL_COLORS).
    // Warming them is best-effort: a failed fetch
    // (transient network blip, cold edge worker, momentarily unreachable
    // backend, one corrupt row) must degrade to defaults, never throw and 500
    // the whole site. `allSettled` never rejects; per-route content loaders
    // still fail loud (and render the localized error boundary) as before.
    //
    // WYPRZEDZAJĄCE menu chrome'u. Rozgrzewka szła dotąd DWIEMA falami:
    // najpierw ustawienia, potem - dopiero po ich rozstrzygnięciu - menu,
    // ticker i widgety chrome'u. Ticker i widgety faktycznie zależą od
    // ustawień (konfiguracja siedzi w `header`/`footer`), ale menu `main`
    // i `footer` mają STAŁE klucze i nie zależą od niczego. Trzymanie ich
    // w drugiej fali dokładało jeden pełny round-trip do TTFB KAŻDEJ strony
    // z chrome'em. Startujemy je tutaj, równolegle z ustawieniami; druga fala
    // dostaje już rozgrzane obietnice i czeka tylko na to, co naprawdę
    // wymagało ustawień.
    const path = location.pathname;
    const showsChrome = showsSiteChrome(path);
    // `.catch(() => null)` przy starcie, nie przy zbieraniu: obietnica leci
    // w tle przez całą pierwszą falę i nieobsłużone odrzucenie w tym oknie
    // wywróciłoby proces renderu.
    const menuWarm: Promise<unknown>[] = showsChrome
      ? [
          import("../lib/menus/queries")
            .then(({ menuWithItemsQueryOptions }) =>
              Promise.all(
                (["main", "footer"] as const).map((key) =>
                  context.queryClient.ensureQueryData(menuWithItemsQueryOptions(key)),
                ),
              ),
            )
            .catch(() => null),
        ]
      : [];

    // FALA 1 - wyłącznie to, czego render nie ma czym zastąpić.
    //
    // `postLayoutSettings` NIE JEST tu już ROZGRZEWANE SIECIOWO: to OSOBNY klucz
    // `edgeTtlCache("post_layout_settings:row")`, czyli osobny round-trip na
    // każdej trasie publicznej. Trasa wpisu/strony grzeje go sobie sama
    // (`routes/$.tsx`), a tu zostaje wyłącznie ZASIEW DOMYŚLNYCH (niżej) -
    // za zero round-tripów.
    //
    // SPROSTOWANIE WŁASNEGO KOMENTARZA (Codex, PR #314, P2). Stało tu, że render
    // „traci wyłącznie typografię prozy, i to na trasach, które i tak jej nie
    // mają". OBA CZŁONY BYŁY NIEPRAWDZIWE i zasiew wypadł razem z rozgrzewką,
    // czego nie zauważyłem. Zmierzone sondą na PRAWDZIWYM `ContentAreaStyle`
    // przez `renderToStaticMarkup`: z pustym cache'em komponent emituje
    // DOSŁOWNIE ZERO BAJTÓW (`components/ContentAreaStyle.tsx:12-13`), a z wpisem
    // - blok z `margin-bottom: 1.5rem` dla akapitu. Zastępstwa w CSS-ie NIE MA:
    // parser `styles.css` znajduje dokładnie dwie reguły marginesu akapitu i obie
    // celują w kanwę edytora, `@tailwindcss/typography` NIE JEST w tym projekcie
    // zainstalowany (czyli `prose prose-lg` w `ContentRenderer` jest MARTWE),
    // a `preflight.css` trzyma `* { margin: 0 }`. Skutek na trasach, które
    // renderują treść redakcyjną, a nie są `/$` (m.in. `/support`, podglądy,
    // `/checkout/success`): akapity schodzą z serwera BEZ ODSTĘPÓW i dostają je
    // po hydratacji - czyli realne przesunięcie układu, nie kosmetyka.
    //
    // Zasiew niżej zamyka to za zero round-tripów i jest PRZYWRÓCENIEM stanu
    // z `main` (tam ten sam `defaultPostLayoutSettings()` był zasiewany
    // w `__root.tsx`), więc nie może być regresją wobec bazy - tylko że tutaj
    // rodzi się `{ updatedAt: 0 }`, czego wersja z maina nie miała.
    //
    // `globalColors` ZOSTAJE, wbrew pozorom bezkosztowo: jego `queryFn` i
    // `queryFn` tokenów wołają TEN SAM `fetchSiteDesignTokensRow()` z dedupem
    // in-flight i wspólnym `edgeTtlCache("site_design_tokens:row")`
    // (lib/builder/designTokens.ts:79-97), więc oba zapytania zbiegają do
    // JEDNEGO fetcha. Wyrzucenie go nie oszczędza ani milisekundy, a zabiera
    // z SSR-owego HTML-a całą połowę `<DesignTokensStyle/>`: `--gc-*`,
    // nadpisania `--background`/`--foreground`/`--primary`/`--card` i mostek
    // klas widgetów - czyli funduje repaint motywu po hydratacji na każdej
    // stronie. Zmierzone: 3 równoległe podżądania -> 2.
    await withBudget(
      Promise.allSettled([
        context.queryClient.ensureQueryData(siteSettingsQueryOptions),
        context.queryClient.ensureQueryData(designTokensQueryOptions),
        context.queryClient.ensureQueryData(globalColorsQueryOptions),
      ]),
      ROOT_WARM_BUDGET_MS,
    );
    // `updatedAt: 0` - zasiew MUSI rodzić się PRZETERMINOWANY.
    //
    // Bez tego argumentu `setQueryData` stempluje wpis `Date.now()`, a
    // `staleTime` tych zapytań to 5-10 minut: jedna czkawka bazy w oknie fali 1
    // przypinała WBUDOWANE DOMYŚLNE w cache'u klienta na cały ten czas i klient
    // nigdy nie dociągał prawdziwej wartości. Dla `site_settings` skutek był
    // najostrzejszy: `Header` zwraca `null`, gdy `builder_data.sections` jest
    // puste (components/Header.tsx), czyli czytelnik oglądał stronę BEZ
    // NAGŁÓWKA do końca wizyty. Doktryna jest w repo o jedną trasę dalej
    // (routes/index.tsx - zasiew z `{ updatedAt: 0 }`, przypięty testem
    // homeRoute.test.tsx: "inaczej strona nie wyleczy się sama po powrocie
    // backendu"); tu jej brakowało.
    if (!context.queryClient.getQueryData(siteSettingsQueryOptions.queryKey)) {
      context.queryClient.setQueryData(siteSettingsQueryOptions.queryKey, Object.freeze({}), {
        updatedAt: 0,
      });
    }
    if (!context.queryClient.getQueryData(designTokensQueryOptions.queryKey)) {
      context.queryClient.setQueryData(designTokensQueryOptions.queryKey, EMPTY_TOKENS, {
        updatedAt: 0,
      });
    }
    if (!context.queryClient.getQueryData(globalColorsQueryOptions.queryKey)) {
      context.queryClient.setQueryData(globalColorsQueryOptions.queryKey, EMPTY_GLOBAL_COLORS, {
        updatedAt: 0,
      });
    }
    // ZASIEW BEZ ROZGRZEWKI - jedyny taki tutaj i dlatego z osobnym zdaniem.
    // Trzy zasiewy wyżej domykają zapytania, które fala 1 PRÓBOWAŁA pobrać; ten
    // domyka klucz, którego fala 1 świadomie NIE dotyka (uzasadnienie wyżej).
    // Bez niego `ContentAreaStyle` emituje w SSR zero bajtów, a odstępy akapitów
    // dochodzą po hydratacji. `{ updatedAt: 0 }` znaczy, że klient i tak
    // dociągnie wartości najemcy natychmiast po hydratacji - domyślne są tu
    // pierwszym malowaniem, nie ostatnim słowem.
    const postLayoutKey = postLayoutSettingsQueryOptions().queryKey;
    if (!context.queryClient.getQueryData(postLayoutKey)) {
      context.queryClient.setQueryData(postLayoutKey, defaultPostLayoutSettings(), {
        updatedAt: 0,
      });
    }
    const settings = context.queryClient.getQueryData<Readonly<Record<string, unknown>>>(
      siteSettingsQueryOptions.queryKey,
    );
    // Domyślna karta społecznościowa z /admin/settings/social-preview. head()
    // jest czystą funkcją bez dostępu do site_settings, więc mapę ustawień
    // (pobieraną i tak na KAŻDEJ trasie) przekazujemy do builderów przez
    // pamięć kluczowaną hostem - patrz src/lib/seo/socialDefaults.ts.
    try {
      const seo = parseSeoSettings(settings?.[SEO_SETTINGS_KEY]);
      rememberSocialDefaults(getOrigin(), {
        imageUrl: seo.default_og_image_url,
        imageAlt: seo.default_og_image_alt,
      });
      // Redakcyjny tytuł i opis serwisu (/admin/settings/site-identity) - ta
      // sama droga: pamięć kluczowana hostem czytana przez buildRootHead()
      // i head() strony głównej.
      rememberBrandDefaults(getOrigin(), {
        title: { pl: seo.site_title_pl, en: seo.site_title_en },
        description: { pl: seo.site_description_pl, en: seo.site_description_en },
      });
    } catch {
      /* karta społecznościowa to dekoracja - nigdy nie wywraca renderu */
    }
    // Warm the header "Na czasie" ticker for every route that shows the site
    // chrome, so the bar is part of the SSR HTML instead of appearing seconds
    // after hydration and pushing the whole page down (the worst CLS on the
    // site). Both fetches sit behind per-isolate TTL caches (see ssrCache /
    // postViews.functions), so in steady state this adds no extra round-trips.
    if (showsChrome) {
      try {
        const header = resolveSetting<HeaderSettings>(settings, "header", {});
        const trending = resolveActiveTickerConfig(header.trending);
        const headerVisible = !!header.builder_data?.sections?.length;
        const tickerWarm =
          headerVisible && trending.enabled !== false
            ? context.queryClient
                .ensureQueryData(headerTickerQueryOptions(trending))
                .catch(() => undefined)
            : Promise.resolve();
        // Nawigacja i pozostałe data-bound widgety CHROME (header + footer to
        // pełnoprawne dokumenty buildera): bez tego SSR renderował fallback
        // "Menu jest puste..." mimo skonfigurowanego menu, a prawdziwe menu
        // wskakiwało dopiero po hydratacji + fetchu - najdłużej widoczny i
        // najbardziej rażący brak na każdej stronie. Zapytania stoją za
        // per-isolate cache (menu: 60 s TTL w getMenuWithItems), więc w
        // stanie ustalonym nie dokładają round-tripów; budżet twardo ogranicza
        // koszt zimnego renderu, a fallbackiem pozostaje fetch kliencki.
        const lang = currentLang();
        const footer = resolveSetting<{ builder_data?: BuilderDocument | null }>(
          settings,
          "footer",
          {},
        );
        const footerDoc = footer.builder_data?.sections?.length
          ? footer.builder_data
          : defaultDocFor("footer");
        // Menu chrome (nawigacja główna + stopka) wystartowało JUŻ przed falą
        // ustawień (patrz `menuWarm` wyżej) - tutaj tylko dołączamy jego
        // obietnice do wspólnego budżetu. W stanie ustalonym są w tym miejscu
        // dawno rozstrzygnięte i nie dokładają do TTFB ani milisekundy.
        // Odrzucenia są już pochłonięte przy starcie: anulowanie strumienia SSR
        // (np. HMR podmieniający moduł w locie) NIE MOŻE zostawić zapytania
        // w stanie `pending` w dehydratowanym `$_TSR.router` - inaczej klient
        // po hydratacji czekałby w nieskończoność na strumień, który nie wróci
        // (poniżej strażnik, który taki stan resetuje).
        const chromeWarm: Promise<unknown>[] = [tickerWarm, ...menuWarm];
        if (headerVisible && header.builder_data) {
          chromeWarm.push(
            prefetchCachedRouteQueries(
              context.queryClient,
              header.builder_data,
              lang,
              CHROME_WARM_BUDGET_MS,
            ),
          );
        }
        if (footerDoc?.sections?.length) {
          chromeWarm.push(
            prefetchCachedRouteQueries(context.queryClient, footerDoc, lang, CHROME_WARM_BUDGET_MS),
          );
        }
        // Ten sam twardy budżet obowiązuje przy pierwszym SSR i przy każdej
        // nawigacji klientowej. Menu/ticker/widget chrome są dekoracją i nie
        // mogą zatrzymać rozwiązania trasy (objaw: URL i przyciski reagują na
        // klik, ale ekran pozostaje bezczynny, bo jeden fetch czeka bez końca).
        // Niedokończone zapytania pozostają w React Query i mogą uzupełnić UI
        // po rozwiązaniu trasy; render ma bezpieczne wartości domyślne.
        await withBudget(Promise.allSettled(chromeWarm), CHROME_WARM_BUDGET_MS);
        // Sanity-guard: jeżeli którekolwiek zapytanie menu zostało anulowane
        // przez HMR i zostało w stanie `pending`, zresetuj je - inaczej klient
        // po hydratacji zawiesi się czekając na strumień, który już nie wróci.
        // Predykat ZAWĘŻONY do zapytań, które NIE MOGĄ się już rozstrzygnąć:
        // `pending` + `fetchStatus: "idle"` + brak danych. Ten sam warunek co
        // `isUnresolvableQuery` (lib/ssr/pruneUnresolvedQueries.ts).
        //
        // Sam `status === "pending"` był za szeroki i przy budżecie 500 ms staje
        // się AKTYWNĄ ŚCIEŻKĄ UTRATY DANYCH: zapytanie, któremu wyczerpał się
        // budżet, ale które NADAL LECI, zdąży się jeszcze rozstrzygnąć w oknie
        // renderu i pojechać do klienta strumieniem integracji
        // router<->query - a usunięcie go tutaj gwarantuje zamiast tego pusty
        // fallback i refetch po hydratacji. Prawdziwy przypadek anulowania (HMR,
        // `revert: true`) łapie i ten predykat, i strażnik w `dehydrate`.
        for (const key of ["main", "footer"] as const) {
          const state = context.queryClient.getQueryState(["menu-with-items", key]);
          if (
            state?.status === "pending" &&
            state.fetchStatus === "idle" &&
            state.data === undefined
          ) {
            context.queryClient.removeQueries({ queryKey: ["menu-with-items", key], exact: true });
          }
        }
      } catch {
        /* chrome warm-up is best-effort decoration - never let it block the site */
      }
    }
    // Nothing reads the root loader's data - return null so the settings map is
    // not serialized a second time into the dehydrated payload.
    return null;
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const lang = currentLang();
  // SSR -> browser handoff of the PUBLIC Supabase config (anon key + URL).
  // The publish build does not inline VITE_SUPABASE_* into client assets, so
  // without this script the browser Supabase client throws at first touch and
  // the root error boundary replaces a fully-rendered page with the error
  // screen (2026-07-16 incident). Emitted in <head>, before the app bundle
  // executes; on hydration the same function re-serializes the value the
  // script itself set, so both passes render identical markup. See
  // lib/supabasePublicConfig.ts.
  const supabaseConfigScript = supabasePublicConfigScript();
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* PIERWSZY skrypt w dokumencie - wszystko po nim jest obserwowalne.
            Klasyczny, nie modułowy: musi przeżyć rzut w chunku vendorowym,
            czyli awarię z 2026-07-20, której żaden handler zainstalowany
            z modułu ani z efektu Reacta nie zobaczy. Wyłącznie buforuje
            w pamięci strony - wysyłka jest w lib/observability, za bramką
            zgody analitycznej. */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_PROBE_SCRIPT }} />
        {supabaseConfigScript ? (
          <script dangerouslySetInnerHTML={{ __html: supabaseConfigScript }} />
        ) : null}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const router = useRouter();
  const { categories, mounted: consentMounted } = useEffectiveConsent();

  // Client observability (Core Web Vitals RUM + global error capture) is
  // analytics data - gate it on the visitor's analytics consent and tear it
  // down if consent is withdrawn (mirrors ConsentScriptInjector). Nothing is
  // beaconed before an explicit opt-in, so no telemetry is collected without
  // consent (RODO/GDPR).
  useEffect(() => {
    if (!consentMounted || !categories.analytics) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    // Prerender (Speculation Rules) nie jest wizytą: telemetria startuje
    // dopiero przy aktywacji strony, inaczej hover zawyżałby RUM.
    const stopPrerenderWait = afterPrerendering(() => {
      void import("../lib/observability").then((m) => {
        if (!cancelled) cleanup = m.initObservability();
      });
    });
    return () => {
      cancelled = true;
      stopPrerenderWait();
      cleanup?.();
    };
  }, [consentMounted, categories.analytics]);

  useEffect(() => {
    // Preview iframe watchdog: reload when the editor preview hangs on boot
    // or the main thread freezes for too long. No-op outside iframes - dlatego
    // ten sam test co wewnątrz modułu wykonujemy PRZED importem: produkcyjny
    // czytelnik (poza iframe'em edytora) nie pobiera i nie parsuje chunku,
    // który i tak zrobiłby no-op w oknie tuż po hydratacji.
    let stopWatchdog: (() => void) | undefined;
    const inPreviewIframe = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();
    // FLAGA GOTOWOŚCI JEST KONTRAKTEM PRODUKCYJNYM, nie instalacją podglądu:
    // czyta ją boot-test na artefakcie produkcyjnym i sonda martwej hydratacji.
    // Ustawiamy ją SYNCHRONICZNIE tutaj, bez round-tripu po leniwy chunk -
    // wcześniej siedziała w środku `previewWatchdog`, importowanego tylko
    // w iframie edytora, więc na publikowanej stronie nie było ANI JEDNEGO
    // sygnału odróżniającego „zhydratowano" od „martwe".
    // PRZEŁADOWANIE zostaje iframe-only (patrz previewWatchdog) - publikowana
    // strona nigdy nie jest przeładowywana pod prawdziwym czytelnikiem.
    markAppReady();
    if (inPreviewIframe) {
      void import("../lib/watchdog/previewWatchdog").then((m) => {
        stopWatchdog = m.startPreviewWatchdog();
      });
    }
    // Attribute Web Vitals to the correct subpage on soft navigations
    // (kategorie, wpisy, strony statyczne). Flush the previous path's
    // accumulators before switching so LCP/CLS/INP land per URL.
    let lastPath = typeof window !== "undefined" ? window.location.pathname : "/";
    const unsub = router.subscribe("onResolved", () => {
      void import("../lib/webVitals").then((m) => {
        const nextPath = window.location.pathname;
        if (nextPath !== lastPath) {
          m.markWebVitalsPage(nextPath);
          lastPath = nextPath;
        }
      });
      // Silnik analityki: page_view przy każdym rozwiązanym routingu
      // (SPA + first paint). Fire-and-forget, respektuje zgodę analytics.
      void import("../lib/analytics/track").then((m) => m.trackPageView());
    });

    // Cache-busting: chunk-load errors -> jednorazowy hard reload; polling
    // /api/public/version -> reload przy najbliższej nawigacji, gdy pojawi
    // się nowy deploy. Odroczone do bezczynności (whenIdle): setup pollingu
    // nie ma żadnej pilności w pierwszych sekundach wizyty, a jego fetch+parse
    // konkurował z dekodowaniem LCP i fontami tuż po hydratacji.
    let stopCacheBusting: (() => void) | undefined;
    const cancelCacheBustingIdle = whenIdle(() => {
      void import("../lib/cacheBusting").then((m) => {
        stopCacheBusting = m.startCacheBusting(router);
      });
    }, 3000);

    // Heartbeat sesji podglądu: iframe podglądu potrafi stracić połączenie z
    // sandboxem (uśpienie, przebudowa po merge, restart dev servera) i zostaje
    // biały aż do ręcznego „Reload preview". Ten moduł wykrywa milczenie pulsu
    // > 30 s, sam prosi powłokę o wznowienie, a w ostateczności przeładowuje
    // dokument z odtworzeniem trasy i pozycji scrolla. Poza kontekstem podglądu
    // (produkcyjna domena, nie w iframie) nie startuje w ogóle.
    let stopPreviewHeartbeat: (() => void) | undefined;
    const cancelHeartbeatIdle = whenIdle(() => {
      void import("../lib/preview/sessionHeartbeat").then((m) => {
        stopPreviewHeartbeat = m.startPreviewHeartbeat(router);
      });
    }, 3000);

    return () => {
      unsub();
      cancelCacheBustingIdle();
      cancelHeartbeatIdle();
      stopWatchdog?.();
      stopCacheBusting?.();
      stopPreviewHeartbeat?.();
    };
  }, [router]);

  // Per-request i18next instance on the server (isolates the render language
  // from concurrent requests); the shared singleton on the client. Rendered
  // once per request on the server, so a mount-stable memo is correct.
  const renderI18n = useMemo(() => getRenderI18n(), []);

  return (
    <I18nextProvider i18n={renderI18n}>
      <ThemeProvider>
        <AuthProvider>
          <IconPackSync />
          <WidgetLiveSync />
          <SiteSettingsLiveSync />
          <CohesionLiveSync />
          <DesignTokensStyle />
          <ContentAreaStyle />
          <ThemeOptionsStyle />
          <ThemeDesignStyle />
          <ThemeFontSizesStyle />
          <ErrorBoundary>
            <GlobalAudioPlayerProvider>
              <SiteChrome>
                <Suspense fallback={<RouteLoadingSkeleton />}>
                  <Outlet />
                </Suspense>
              </SiteChrome>
              <GlobalAudioBarGate />
            </GlobalAudioPlayerProvider>
          </ErrorBoundary>
          <ConsentScriptInjector />
          <Suspense fallback={null}>
            <ConsentBanner />
            <ConsentPreviewPanel />
            <LoginPopup />
            <NewsletterPopup />
            <PopupHost />
            <CommandPalette />
          </Suspense>
          <UnsavedChangesGuardHost />
          <AppDialogHost />
          <Suspense fallback={null}>
            <ExpertRequestDialogHost />
          </Suspense>
          <Suspense fallback={null}>
            <Toaster />
          </Suspense>
        </AuthProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
