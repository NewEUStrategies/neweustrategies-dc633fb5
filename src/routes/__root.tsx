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
import { fontPreloadLinks, fontPreloadLinkHeaderValues } from "../lib/seo/fontPreload";
import { appendLinkHeader } from "../lib/http/responseHeaders";
import { buildRootHead, feedDiscoveryLinks } from "../lib/seo/meta";
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
import { postLayoutSettingsQueryOptions } from "../hooks/usePostLayoutSettings";
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
import { defaultPostLayoutSettings } from "../lib/postLayouts";
import { withBudget } from "../lib/asyncBudget";

const ROOT_WARM_BUDGET_MS = 2_500;

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
      links: [
        { rel: "stylesheet", href: appCss },
        // Favicon - jawnie zadeklarowany, żeby crawlery i podglądy linków
        // (w tym karta "How your site appears") pobrały znak marki NES.
        { rel: "icon", href: "/favicon.ico", sizes: "any" },
        { rel: "apple-touch-icon", href: "/favicon.ico" },

        // Preload the critical font subset(s) so heading text (a frequent LCP
        // element) swaps in without waiting for the CSS to parse first. Latin
        // backs both languages; Latin-ext (Polish diacritics) only for PL.
        ...fontPreloadLinks(lang, {
          latin: redHatDisplayLatin,
          latinExt: redHatDisplayLatinExt,
        }),
        { rel: "dns-prefetch", href: "https://unnltowbgszpdzwpawdu.supabase.co" },
        {
          rel: "preconnect",
          href: "https://unnltowbgszpdzwpawdu.supabase.co",
          crossOrigin: "anonymous",
        },
        // DRUGI preconnect, bez crossOrigin - to nie duplikat: przeglądarka
        // kluczuje połączenia parą (origin, tryb poświadczeń). Wariant
        // "anonymous" rozgrzewa wyłącznie pulę CORS (fetch supabase-js),
        // a KAŻDY <img> okładki/treści i preload LCP idą w trybie no-cors
        // i płaciły pełny DNS+TCP+TLS na zimnym połączeniu (Lighthouse:
        // "preconnect found but not used by the browser"). Dwa preconnecty
        // do jednego originu to standardowy wzorzec dla hostów serwujących
        // jednocześnie ruch CORS i no-CORS.
        { rel: "preconnect", href: "https://unnltowbgszpdzwpawdu.supabase.co" },
        // RSS autodiscovery for both language feeds, on every page - feed
        // readers and crawlers find the feeds regardless of the entry URL.
        ...feedDiscoveryLinks(getOrigin()),
      ],
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
    appendLinkHeader(`<${appCss}>; rel="preload"; as="style"`);
    // Preconnect (tryb z poświadczeniami, jak <img>) także z nagłówka HTTP:
    // handshake do hosta obrazów startuje z nagłówków odpowiedzi / 103 Early
    // Hints, zanim parser dojdzie do <head>. Odpowiednik <link> wyżej.
    appendLinkHeader('<https://unnltowbgszpdzwpawdu.supabase.co>; rel="preconnect"');
    for (const value of fontPreloadLinkHeaderValues(currentLang(), {
      latin: redHatDisplayLatin,
      latinExt: redHatDisplayLatinExt,
    })) {
      appendLinkHeader(value);
    }
    // Warm site_settings + design tokens / global colors / post-layout so
    // <DesignTokensStyle />, <ContentAreaStyle /> and friends render their
    // `<style>` server-side. Without this the first paint uses raw styles.css
    // defaults (dark navy fallback) and only switches to the tenant palette
    // after client-side hydration - a jarring flash of unstyled theme.
    //
    // CRITICAL: this loader runs on EVERY route, so it MUST NOT be a single
    // point of total failure. These are all presentation-layer caches with
    // built-in defaults (resolveSetting / EMPTY_TOKENS / EMPTY_GLOBAL_COLORS /
    // defaultPostLayoutSettings). Warming them is best-effort: a failed fetch
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
    const showsChrome =
      path !== "/admin" &&
      !path.startsWith("/admin/") &&
      path !== "/login" &&
      !path.startsWith("/login/");
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

    await withBudget(
      Promise.allSettled([
        context.queryClient.ensureQueryData(siteSettingsQueryOptions),
        context.queryClient.ensureQueryData(designTokensQueryOptions),
        context.queryClient.ensureQueryData(globalColorsQueryOptions),
        context.queryClient.ensureQueryData(postLayoutSettingsQueryOptions()),
      ]),
      ROOT_WARM_BUDGET_MS,
    );
    if (!context.queryClient.getQueryData(siteSettingsQueryOptions.queryKey)) {
      context.queryClient.setQueryData(siteSettingsQueryOptions.queryKey, Object.freeze({}));
    }
    if (!context.queryClient.getQueryData(designTokensQueryOptions.queryKey)) {
      context.queryClient.setQueryData(designTokensQueryOptions.queryKey, EMPTY_TOKENS);
    }
    if (!context.queryClient.getQueryData(globalColorsQueryOptions.queryKey)) {
      context.queryClient.setQueryData(globalColorsQueryOptions.queryKey, EMPTY_GLOBAL_COLORS);
    }
    const postLayoutKey = postLayoutSettingsQueryOptions().queryKey;
    if (!context.queryClient.getQueryData(postLayoutKey)) {
      context.queryClient.setQueryData(postLayoutKey, defaultPostLayoutSettings());
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
            prefetchCachedRouteQueries(context.queryClient, header.builder_data, lang, 2500),
          );
        }
        if (footerDoc?.sections?.length) {
          chromeWarm.push(prefetchCachedRouteQueries(context.queryClient, footerDoc, lang, 2500));
        }
        // Ten sam twardy budżet obowiązuje przy pierwszym SSR i przy każdej
        // nawigacji klientowej. Menu/ticker/widget chrome są dekoracją i nie
        // mogą zatrzymać rozwiązania trasy (objaw: URL i przyciski reagują na
        // klik, ale ekran pozostaje bezczynny, bo jeden fetch czeka bez końca).
        // Niedokończone zapytania pozostają w React Query i mogą uzupełnić UI
        // po rozwiązaniu trasy; render ma bezpieczne wartości domyślne.
        await withBudget(Promise.allSettled(chromeWarm), ROOT_WARM_BUDGET_MS);
        // Sanity-guard: jeżeli którekolwiek zapytanie menu zostało anulowane
        // przez HMR i zostało w stanie `pending`, zresetuj je - inaczej klient
        // po hydratacji zawiesi się czekając na strumień, który już nie wróci.
        for (const key of ["main", "footer"] as const) {
          const state = context.queryClient.getQueryState(["menu-with-items", key]);
          if (state?.status === "pending") {
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

// No stored choice -> follow the OS preference (prefers-color-scheme); an
// explicit toggle in ThemeProvider persists to localStorage and wins from then on.
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

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
        {supabaseConfigScript ? (
          <script dangerouslySetInnerHTML={{ __html: supabaseConfigScript }} />
        ) : null}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
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
    if (inPreviewIframe) {
      void import("../lib/watchdog/previewWatchdog").then((m) => {
        m.markPreviewAppReady();
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
