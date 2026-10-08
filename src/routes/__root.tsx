import { afterPageLoad } from "../lib/performance/afterPageLoad";
import { LoginPopupHost } from "../components/LoginPopupHost";
import { CommandPaletteHost } from "../components/search/CommandPaletteHost";
import { ExpertRequestDialogHost } from "../components/chat/ExpertRequestDialogHost";
import { widgetPreloadHeaders } from "../lib/seo/widgetPreloads";
import { createBackgroundScope } from "@/lib/backgroundScope";
import { RouteLoadingSkeleton } from "../lib/ssr/RouteLoadingSkeleton";
import { QueryClient, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { isServer } from "@tanstack/router-core/isServer";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { createIsomorphicFn } from "@tanstack/react-start";
import { I18nextProvider } from "react-i18next";

import appCss from "../styles.css?url";
// Fingerprinted by Vite to the SAME emitted file the @font-face in styles.css
// references, so the preload is reused (not a second download). See styles.css.
import redHatDisplayLatin from "../assets/fonts/red-hat-display-latin.woff2?url";
import redHatDisplayLatinExt from "../assets/fonts/red-hat-display-latin-ext.woff2?url";
import { appendLinkHeader, setCacheControlHeader } from "../lib/http/responseHeaders";
import { markDeliberateSeed, resilientCacheControl } from "../lib/ssr/resilientLoad";
import { chromeDegradedCacheControl } from "../lib/http/cachePolicy";
import {
  HOME_THEME_BUDGET_MS,
  hasSsrQueryData,
  homeSsrDeadline,
  remainingHomeBudget,
} from "../lib/ssr/homeSsrBudget";
import { buildRootHead } from "../lib/seo/meta";
import {
  dictionaryPreloadLinkHeaderValue,
  rootDocumentLinks,
  rootLinkHeaderValues,
  type RootAssets,
} from "../lib/seo/rootHead";
import { LOCALE_CHUNK_URLS } from "../lib/seo/localeChunks";
import { showsSiteChrome } from "../lib/routing/siteChrome";
import {
  CHROME_ONLY_WARM_BUDGET_MS,
  CLIENT_ONLY_WARM_BUDGET_MS,
  isChromeOnlyDocument,
  isClientOnlyDocument,
} from "../lib/routing/clientOnlyDocument";
import { THEME_INIT_SCRIPT } from "../lib/theme/themeInitScript";
// Skrypty zgód i powłoka banera - WYŁĄCZNIE w gałęziach `.server()` niżej
// (`RootShell`, `ConsentShellSlot`): kompilator Start wycina je z bundla
// przeglądarki razem z tymi importami. W przeglądarce `consentInitScript` to
// leniwy chunk partnera skryptu (`ConsentSurface`).
import { CONSENT_INIT_SCRIPT, CONSENT_SHELL_REVEAL_SCRIPT } from "../lib/consent/consentInitScript";
import type { ConsentTakeover } from "../lib/consent/consentInitScript";
import { ConsentShell } from "../components/consent/ConsentShell";
import type { ConsentBannerProps } from "../components/ConsentBanner";
import { DOCK_RESERVE_INIT_SCRIPT } from "../lib/dock/reservedSpace";
// Teksty sondy i loadera bootu - WYŁĄCZNIE w gałęziach `.server()` niżej (`bootProbeScript`,
// `bootLoaderScript`): kompilator Start wycina je z bundla przeglądarki razem z tymi importami.
import { BOOT_PROBE_SCRIPT } from "../lib/observability/bootProbeScript";
import { BOOT_LOADER_SCRIPT } from "../lib/boot/bootLoaderScript";
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
// Ekran błędu za leniwą granicą - nie należy do udanego pierwszego renderu
// (uzasadnienie i kontrakt SSR: components/error/LazyFriendlyErrorPage.tsx).
import { LazyFriendlyErrorPage } from "../components/error/LazyFriendlyErrorPage";
import { ThemeProvider } from "../components/ThemeProvider";
import { AuthProvider, useAuth } from "../hooks/useAuth";
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
import { WIDGET_QUERY_ROOTS } from "../lib/builder/queryKeys";
import { whenIdle } from "../lib/ads/idle";
import { adPageTypeForLocation } from "../lib/ads/pageType";
import { adPlacementsQueryOptions } from "../lib/ads/queries";

import { ErrorBoundary } from "../components/ErrorBoundary";
import { onFirstToast } from "../lib/notify";
import { resolveSetting, siteSettingsQueryOptions } from "../lib/useSiteSetting";
import { parseSeoSettings, SEO_SETTINGS_KEY } from "../lib/seo/settings";
import { rememberSocialDefaults } from "../lib/seo/socialDefaults";
import { rememberBrandDefaults } from "../lib/seo/brandDefaults";
import { headerTickerQueryOptions } from "../lib/views/headerTickerQuery";
import { resolveActiveTickerConfig } from "../lib/views/tickerVariants";
import { designTokensQueryOptions } from "../lib/builder/designTokens";
import { globalColorsQueryOptions } from "../hooks/useGlobalColors";
// Lekki moduł z pustym domyślnym - nie `globalColors.ts` (44 kB katalogu
// slotów), który od 2026-10 dociera do przeglądarki wyłącznie leniwie.
import { EMPTY_GLOBAL_COLORS } from "../lib/builder/globalColorsValue";
import type { HeaderSettings } from "../components/Header";
import type { BuilderDocument } from "../lib/builder/types";
import { defaultDocFor } from "../lib/builder/chromeDefaults";
import { prefetchCachedRouteQueries, sectionQueryOptionsList } from "../lib/builder/prefetch";
import { SiteChrome } from "../components/SiteChrome";
import { GlobalAudioPlayerProvider, useGlobalAudioPlayer } from "../lib/audio/global-player";
import { UnsavedChangesGuardHost } from "../components/UnsavedChangesGuardHost";
import { AppDialogHost } from "../components/AppDialogHost";
import { EMPTY_TOKENS } from "../lib/builder/designTokens";
import { withBudget } from "../lib/asyncBudget";
import { registerChromeWarmup } from "../lib/ssr/chromeWarmup";
import {
  asGa4MeasurementId,
  ga4SsrSnippet,
  GA4_MEASUREMENT_ID,
  GOOGLE_ADS_ID,
} from "../lib/analytics/ga4Client";
import { AnalyticsConfigSchema, defaultAnalyticsConfig } from "../lib/analytics/config";

export const ROOT_WARM_BUDGET_MS = 2_500;

/** Header/footer data may suspend only their own render boundaries for 500 ms.
 * The root loader starts the work without awaiting it. ChromeDataGate restarts
 * a pending query after the pre-render serialization sweep when necessary.
 */
export const CHROME_WARM_BUDGET_MS = 500;

// Nakładki (popupy, paleta komend, pasek audio) nie są potrzebne do pierwszego
// malowania ŻADNEJ strony - React.lazy trzyma je poza bundlem wejściowym
// (wcześniej ładowały się na każdej stronie: cmdk, formularz newslettera z
// rendererem dokumentów, formularz logowania...). Fallback null = zero CLS,
// bo wszystkie renderują się jako overlaye/portale poza przepływem dokumentu.
const NewsletterPopup = lazy(() =>
  import("../components/NewsletterPopup").then((m) => ({ default: m.NewsletterPopup })),
);
const PopupHost = lazy(() =>
  import("../components/popups/PopupHost").then((m) => ({ default: m.PopupHost })),
);
const GlobalAudioBar = lazy(() =>
  import("../components/audio/GlobalAudioBar").then((m) => ({ default: m.GlobalAudioBar })),
);
// Baner zgód NIE jest tu `React.lazy`: przejmuje miejsce powłoki SSR (P1.3,
// `ConsentSurface` niżej), a `lazy` przy pierwszym renderze zawiesza się na
// własnej fabryce nawet przy załadowanym module - granica pokazałaby wtedy
// fallback, czyli klatkę bez karty. `ConsentSurface` dociąga moduł `import()`
// i renderuje gotowy komponent, więc podmiana powłoki na baner to JEDEN commit.
// Chunk banera (~1400 linii: baner, cookieBanner/config, registry) nadal jest
// poza zamknięciem bootu.
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

// ── ŻYWA SYNCHRONIZACJA (realtime) - WYŁĄCZNIE DLA ZALOGOWANYCH ───────────
//
// Wszystkie trzy mostki są z definicji redakcyjne/członkowskie i KAŻDY z nich
// sam w sobie no-opuje dla anonima:
//   * `WidgetLiveSync`, `SiteSettingsLiveSync` - kanały `postgres_changes` stoją
//     za `isStaff`, a lokalna podpowiedź to `window.dispatchEvent` wewnątrz
//     TEGO SAMEGO dokumentu, czyli nadawcą jest zawsze mutacja panelu w tej
//     karcie (anonim nie ma jej skąd wysłać);
//   * `CohesionLiveSync` - oba haki (`useDomainEventInvalidation`,
//     `usePendingCountersRealtime`) wychodzą na `if (!uid) return`.
// Statyczny import ciągnął mimo to do chunku wejściowego całą ich zależność:
// klienta Realtime (`vendor-supabase`) i mapę inwalidacji `eventInvalidationMap`
// (~14,9 kB źródeł) - kod, którego anonimowy czytelnik NIGDY nie wykona
// (audyt CWV 2026-09-20, F23). `React.lazy` + montaż dopiero po rozstrzygnięciu
// sesji przenosi to poza domknięcie bootu strony publicznej.
const WidgetLiveSync = lazy(() =>
  import("../lib/builder/widgetCacheInvalidation").then((m) => ({ default: m.WidgetLiveSync })),
);
const SiteSettingsLiveSync = lazy(() =>
  import("../lib/builder/siteSettingsLiveSync").then((m) => ({ default: m.SiteSettingsLiveSync })),
);
const CohesionLiveSync = lazy(() =>
  import("../lib/realtime/cohesionLiveSync").then((m) => ({ default: m.CohesionLiveSync })),
);

/**
 * Mostki realtime montowane dopiero, gdy sesja jest ROZSTRZYGNIĘTA i niepusta.
 *
 * `loading` z `useAuth` jest tu równie ważne jak `user`: bez niego pierwszy
 * render (sesja jeszcze w `localStorage`) wyglądałby jak „anonim" i mostki
 * zamontowałyby się dopiero po przeskoku stanu - czyli ten sam pop-in, tylko
 * przesunięty. Odmontowanie przy wylogowaniu zamyka kanały (efekty wewnątrz
 * mostków mają własne `removeChannel`).
 */
function AuthenticatedLiveSync() {
  const { user, loading } = useAuth();
  if (loading || !user) return null;
  return (
    <Suspense fallback={null}>
      <WidgetLiveSync />
      <SiteSettingsLiveSync />
      <CohesionLiveSync />
    </Suspense>
  );
}

/**
 * Ile czekamy z montażem nakładek „na później" (newsletter, popupy buildera,
 * Toaster). Te same 3 000 ms, co heartbeat niżej: nic z tego nie ma prawa
 * konkurować z LCP ani z pierwszą interakcją.
 */
const OVERLAY_IDLE_TIMEOUT_MS = 3_000;

/**
 * Kiedy montować leniwe nakładki korzenia (audyt CWV 2026-09-20, F19).
 *
 * PROBLEM. Pięć nakładek (`ConsentBanner`, `ConsentPreviewPanel`,
 * `NewsletterPopup`, `PopupHost`, `Toaster`) było renderowanych BEZWARUNKOWO,
 * a `React.lazy` startuje `import()` przy PIERWSZYM renderze - czyli pięć
 * żądań chunków lądowało w commicie hydratacji, w oknie LCP i pierwszej
 * interakcji KAŻDEJ strony. „Leniwy" znaczyło tu tylko „w osobnym pliku",
 * nigdy „później".
 *
 * BANER ZGÓD MA OD P1.3 WŁASNĄ DROGĘ (`ConsentSurface` niżej, kontrakt
 * przepisany jawnie): baner jest WIDOCZNY bezwarunkowo od pierwszego malowania
 * (powłoka SSR), opóźniona jest wyłącznie jego interaktywność. Nadal obowiązuje
 * istota dawnego kontraktu: stan zgody w `overlayCoordinator` musi być
 * zgłaszany BEZ WZGLĘDU na decyzję - do montażu banera zgłasza go partner
 * skryptu zgód w imieniu powłoki (od hydratacji), po montażu efekty banera.
 * Dzięki temu MOMENT montażu może już zależeć od decyzji (poprawka 1 P1.3,
 * D6): przy zapisanej decyzji baner (który i tak renderuje `null`) montuje się
 * dopiero w punkcie ciszy, a nie w pierwszym zadaniu po interakcji - brama
 * nakładek nie traci przez to ani jednego zgłoszenia.
 *
 * DLACZEGO `overlaysReady` NIE CZEKA NA BANER (recenzja Codex, PR #382).
 * Nakładki planują się niezależnie od baneru, więc przez chwilę - zanim jego
 * leniwy chunk dojedzie - popup buildera z wyzwalaczem „immediate" mógł
 * poprosić o slot, gdy koordynator nie wiedział jeszcze NIC o zgodzie.
 * Bramę trzyma dziś `overlayCoordinator` (flaga `consentReported`): żaden wpis
 * `marketing: true` nie dostanie slotu przed pierwszym zgłoszeniem stanu zgody
 * (od P1.3 zgłasza go korzeń zaraz po hydratacji, potem baner). Drugiej
 * warstwy tutaj świadomie NIE dokładamy: montaż `NewsletterPopup` i
 * `PopupHost` to samo pobranie chunku i uzbrojenie wyzwalaczy (nic nie widać),
 * więc wiązanie go ze zgodami przesunęłoby tę pracę z okna bezczynności w
 * gorszy moment, a nakładka spoza tego drzewa (pasek reklamowy w stopce) i tak
 * omijałaby bramkę z `__root`. Czas montażu nakładek jest celowo BEZ ZMIAN
 * (P1.3, TP-4 „tylko części niewidoczne"): od niego liczą się wyzwalacze
 * `delay`/`immediate`, więc późniejszy montaż byłby widocznie późniejszym
 * popupem.
 */
function useOverlayGates(): { overlaysReady: boolean } {
  const [overlaysReady, setOverlaysReady] = useState(false);

  useEffect(() => {
    const cancel = afterPageLoad(() => setOverlaysReady(true), OVERLAY_IDLE_TIMEOUT_MS);
    return cancel;
  }, []);

  return { overlaysReady };
}

// ── POWŁOKA I BANER ZGÓD (P1.3) ───────────────────────────────────────────
//
// PIERWSZE MALOWANIE. Serwer renderuje statyczną powłokę kompaktowej karty
// (`ConsentShell`) w gnieździe `[data-consent-shell-slot]`; skrypt inline
// `CONSENT_INIT_SCRIPT` w `<head>` ukrywa ją przed malowaniem, gdy decyzja już
// leży w przeglądarce, i zapisuje decyzję klikniętą w powłoce (także przed
// bootem) - patrz `lib/consent/consentInitScript.ts`.
//
// ODSŁONIĘCIE (P1.3b). Ostatnim dzieckiem gniazda jest statyczny skrypt
// `CONSENT_SHELL_REVEAL_SCRIPT` (`html[data-consent-parsed]`); do jego
// wykonania karta ma `display: none`. Gniazdo leży za stopką, a karta jest
// `fixed` od dołu - parser oddający wątek w środku karty malował uciętą kartę,
// która przy dopisaniu reszty rosła w górę (przesunięcie układu, bramka fali
// 1, kryterium (d)). Skrypt stoi w gnieździe także przy wyłączonym banerze
// (karty brak), bo partner skryptu czyta brak atrybutu po boocie jako
// „powłoki nie widać" i montowałby baner od razu (zbędny import chunku).
//
// HYDRATACJA. Przeglądarka NIE ma kodu powłoki (gałąź `.server()` wycina
// kompilator Start). Gniazdo renderuje się z `dangerouslySetInnerHTML` równym
// migawce własnego HTML-a odczytanej z DOM-u w pierwszym renderze: React przy
// hydratacji nie dotyka `innerHTML` (produkcja), a w DEV porównuje ten sam
// napis, więc rozjazdu nie ma; gniazdo jest `memo` bez zmiennych propsów, więc
// żaden re-render nie przepisuje węzłów. Koszt powłoki w zamknięciu bootu:
// zero bajtów JS i zero elementów do hydratacji.
//
// INTERAKTYWNOŚĆ. Baner (leniwy chunk) zastępuje gniazdo w jednym commicie
// (bez `animate-in`, ta sama karta - `ConsentCompactCard`):
//  - po pierwszej interakcji: kolejka P0.3, klasa `shell`, `target` = gniazdo
//    (pierwsze zadanie po interakcji). Kolejka rusza na `pointerdown`, ale
//    strażnik gestu (P0.3-FIX) trzyma krok do `click`/`pointerup`, a decyzję
//    i tak utrwala delegowany `click` skryptu inline - podmiana w trakcie
//    dotknięcia niczego nie gubi;
//  - NATYCHMIAST przy intencji z powłoki („Dostosuj", PL/EN) i przy
//    `requestConsentPreferences()` (link „Ustawienia cookies"): tor pilny
//    kolejki (`release: "urgent"` - start importu banera);
//  - od razu po boocie (`release: "immediate"`), gdy karta zgód należy się
//    odwiedzającemu, ale powłoki nie widać (sygnał GPC - karta banera ma notę;
//    skrypt inline albo skrypt odsłonięcia się nie wykonał) albo gdy powłoka
//    powstała z zasiewu ustawień, a prawdziwe właśnie dojechały;
//  - w ostateczności w punkcie ciszy P0.3 (`onQuiescent`, klasa `shell`);
//    przy zapisanej decyzji (powłoka ukryta) WYŁĄCZNIE tam (klasa `overlays`) -
//    bez wpisu w pierwszym zadaniu po interakcji.
// Zadanie montażu zwraca promise rozstrzygany po commicie banera (`onReady`),
// więc kolejka nie nakłada następnej pracy na jego montaż (KONTRAKT ZADANIA).
// Harmonogram prowadzi partner skryptu (`startConsentTakeover`) z leniwego
// chunku `lib/consent/consentInitScript`, dociąganego `import()` po
// hydratacji - prymitywy P0.3 i koordynator nie wchodzą do zamknięcia bootu
// (ten sam wybór co P1.1; PÓŹNY IMPORT w `whenQuiescent.ts`: kliknięcie sprzed
// importu łapie lepka aktywacja, a decyzję i tak zapisał skrypt inline, który
// zostawia znacznik do domknięcia).
//
// KOORDYNATOR NAKŁADEK. Do montażu banera stan zgody zgłasza partner skryptu
// w imieniu powłoki (`reportConsentSurface`, ten sam warunek co efekt banera):
// powłoka widoczna = brak decyzji = brama zamknięta. Po montażu pisze baner.

const SHELL_SLOT_ATTR = "data-consent-shell-slot";

const getServerConsentShell = createIsomorphicFn()
  .server((): ComponentType | null => ConsentShell)
  .client((): ComponentType | null => null);
const ServerConsentShell = getServerConsentShell();

// Skrypt odsłonięcia powłoki (P1.3b) - render serwera; przeglądarka ma go
// w migawce `innerHTML` gniazda, więc stała nie wchodzi do bundla klienta.
const getServerShellRevealScript = createIsomorphicFn()
  .server((): string => CONSENT_SHELL_REVEAL_SCRIPT)
  .client((): string => "");
const SERVER_SHELL_REVEAL_SCRIPT = getServerShellRevealScript();

/** Migawka HTML-a powłoki z DOM-u - to, co wyrenderował serwer (pusty napis bez SSR). */
function readShellSlotHtml(): string {
  const slot =
    typeof document === "undefined" ? null : document.querySelector(`[${SHELL_SLOT_ATTR}]`);
  return slot?.innerHTML ?? "";
}

/**
 * Gniazdo powłoki: serwer renderuje powłokę, przeglądarka zostawia jej HTML.
 * `memo` + stan = gniazdo nie renderuje się drugi raz, więc React nigdy nie
 * przepisuje `innerHTML` (nowy obiekt `{__html}` przy re-renderze odtworzyłby
 * węzły i zgubił fokus). `server` - komponent powłoki (serwer) albo `null`
 * (przeglądarka); domyślnie wynik `createIsomorphicFn` wyżej, prop jest
 * wyłącznie dla testu hydratacji. Skrypt odsłonięcia stoi ZA powłoką
 * (ostatnie dziecko gniazda) - patrz „ODSŁONIĘCIE" wyżej.
 */
export const ConsentShellSlot = memo(function ConsentShellSlot({
  server: Server = ServerConsentShell,
}: {
  server?: ComponentType | null;
}) {
  const [shellHtml] = useState(readShellSlotHtml);
  if (Server) {
    return (
      <div data-consent-shell-slot="" className="contents">
        <Server />
        <script dangerouslySetInnerHTML={{ __html: SERVER_SHELL_REVEAL_SCRIPT }} />
      </div>
    );
  }
  return (
    <div
      data-consent-shell-slot=""
      className="contents"
      dangerouslySetInnerHTML={{ __html: shellHtml }}
    />
  );
});

interface MountedConsentBanner {
  Banner: ComponentType<ConsentBannerProps>;
  takeover: ConsentTakeover;
}

/**
 * Przejęcie powłoki przez baner. Harmonogram (kolejka P0.3, tor pilny, punkt
 * ciszy), decyzje i intencje z powłoki oraz zgłoszenia do koordynatora
 * prowadzi partner skryptu `startConsentTakeover` z leniwego chunku
 * `lib/consent/consentInitScript` - tutaj zostaje tylko stan i montaż.
 */
function useConsentTakeover(): {
  mounted: MountedConsentBanner | null;
  onReady: () => void;
} {
  const [mounted, setMounted] = useState<MountedConsentBanner | null>(null);
  const settle = useRef<(() => void) | null>(null);
  // Czy powłoka powstała z ZASIEWU ustawień (SSR bez `site_settings` w terminie
  // fali 1). Odczyt w PIERWSZYM renderze - zanim obserwatorzy zapytania
  // wystartują refetch; partner przekazuje kartę banerowi, gdy dojadą
  // prawdziwe ustawienia (`ConsentTakeoverHost.settings`).
  const queryClient = useQueryClient();
  const [settingsSeeded] = useState(
    () => queryClient.getQueryState(siteSettingsQueryOptions.queryKey)?.dataUpdatedAt === 0,
  );
  const onReady = useCallback(() => {
    settle.current?.();
    settle.current = null;
  }, []);

  useEffect(() => {
    let active = true;
    let stop: () => void = () => {};
    // Import banera, potem JEDEN commit podmiany; promise rozstrzyga `onReady`
    // z efektu warstwy banera (albo limit kolejki P0.3).
    const mount = (takeover: ConsentTakeover): Promise<void> =>
      import("../components/ConsentBanner").then(
        (m) =>
          new Promise<void>((resolve) => {
            if (!active) return resolve();
            settle.current = resolve;
            setMounted({ Banner: m.ConsentBanner, takeover });
          }),
      );
    void import("../lib/consent/consentInitScript").then(
      ({ startConsentTakeover }) => {
        if (!active) return;
        stop = startConsentTakeover({
          mount,
          slot: document.querySelector(`[${SHELL_SLOT_ATTR}]`),
          settings: { queryClient, seeded: settingsSeeded },
        });
      },
      () => {
        // Chunk partnera nie dojechał (np. dokument sprzed wdrożenia): baner
        // od razu - interaktywność ważniejsza niż odroczenie.
        if (active) void mount({ intent: null, focus: null }).catch(() => undefined);
      },
    );
    return () => {
      active = false;
      stop();
    };
  }, [queryClient, settingsSeeded]);

  return { mounted, onReady };
}

/**
 * Powłoka zgód z SSR, po interakcji interaktywny baner w jej miejscu. Poza
 * granicą `Suspense` nakładek: zawieszenie sąsiada (np. `NewsletterPopup`)
 * pokazałoby fallback całej granicy, a więc ukryło powłokę.
 */
export const ConsentSurface = memo(function ConsentSurface() {
  const { mounted, onReady } = useConsentTakeover();
  if (mounted) return <mounted.Banner takeover={mounted.takeover} onReady={onReady} />;
  return <ConsentShellSlot />;
});

/**
 * `PopupHost` nie montuje się tylko wtedy, gdy ISTNIEJĄCE dane SSR jednoznacznie
 * mówią „brak aktywnych popupów" (P1.3, TP-4): odwodniony wpis zapytania
 * `useActivePopups` z pustą listą. Bez nowego zapisu dehydratacji
 * (`check:ssr-budgets`) - dziś żaden loader tego klucza nie grzeje, więc host
 * montuje się jak dotąd; bramka zadziała sama, gdy wpis pojawi się w stanie SSR.
 * UWAGA: wartość jest ZAMROŻONA na całą wizytę (odczyt raz, w pierwszym
 * renderze) - popup aktywowany w trakcie tej samej sesji nie zamontuje hosta
 * do następnego wejścia. Kto zacznie grzać ten klucz w SSR, musi to przyjąć
 * albo zamienić odczyt na subskrypcję zapytania.
 */
export function useNoActivePopupsFromSsr(): boolean {
  const queryClient = useQueryClient();
  const [empty] = useState(() => {
    const data = queryClient.getQueryData([WIDGET_QUERY_ROOTS.popupsActive]);
    return Array.isArray(data) && data.length === 0;
  });
  return empty;
}

/**
 * Czy `<Toaster/>` (chunk sonnera) ma być już zamontowany.
 *
 * DWA NIEZALEŻNE WYZWALACZE, oba potrzebne:
 *   1. `onFirstToast` z `lib/notify.ts` - NATYCHMIAST, gdy toast pada wcześniej
 *      niż bezczynność. Bez tego toast ze ścieżki bootowania przepadłby
 *      (sonner nie odtwarza historii nowym subskrybentom);
 *   2. `afterPageLoad(…, 3000)` - bezwarunkowo, bo most `lib/notify.ts` widzi
 *      WYŁĄCZNIE swoich wołających, a `import { toast } from "sonner"` wprost
 *      robi w tym repozytorium kilkaset modułów (m.in. akcje przy wpisie).
 *      Gdyby montaż zależał tylko od mostu, ich toasty ginęłyby bez śladu.
 * Pierwszy wyzwalacz skraca czas do montażu; drugi jest gwarancją poprawności.
 * Efekt netto dla F19: chunk sonnera wychodzi z commitu hydratacji.
 */
function useToasterWanted(): boolean {
  const [wanted, setWanted] = useState(false);

  useEffect(() => {
    if (wanted) return;
    const stopListening = onFirstToast(() => setWanted(true));
    const cancelIdle = afterPageLoad(() => setWanted(true), OVERLAY_IDLE_TIMEOUT_MS);
    return () => {
      stopListening();
      cancelIdle();
    };
  }, [wanted]);

  return wanted;
}

/** Czy adres prosi o panel podglądu zgód (`?consent-preview=1`). */
function useConsentPreviewRequested(): boolean {
  return useRouterState({
    select: (s) => {
      const value = (s.location.search as Record<string, unknown>)["consent-preview"];
      // Router parsuje wartości wyszukiwania (`1` bywa liczbą, nie napisem),
      // więc porównujemy po normalizacji - inaczej panel nie otworzyłby się
      // nigdy, a defekt byłby niemy.
      return value === 1 || value === "1";
    },
  });
}

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

  return <LazyFriendlyErrorPage error={error} reset={reset} />;
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

// Identyfikator pomiaru GA4 dla tagu w SSR: zmienna konektora Google Analytics
// (build-time) WYŁĄCZNIE gdy ma kształt identyfikatora pomiaru - klucz API
// podstawiony pod tę zmienną nie może trafić do publicznego HTML - a w
// przeciwnym razie stała wdrożenia. Ta sama kolejność co w bootstrapie
// klienckim (`resolveBrowserGa4Id`), więc SSR i klient mówią o jednym strumieniu.
const ROOT_GA4_ID: string =
  asGa4MeasurementId(import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_ANALYTICS_API_KEY) ||
  GA4_MEASUREMENT_ID;

/** Tag Google emitowany w SSR: strumień GA4 z ustawień najemcy albo stała wdrożenia. */
interface SsrGoogleTag {
  measurementId: string;
  enabled: boolean;
}

const DEFAULT_SSR_GOOGLE_TAG: SsrGoogleTag = { measurementId: ROOT_GA4_ID, enabled: true };

/**
 * Strumień GA4 dla tagu w `<head>` z wpisu panelu analityki
 * (`site_settings.analytics`), którego `head()` sam nie widzi - jedzie przez
 * `loaderData` korzenia. Wpis o kształcie innym niż `G-XXXXXXXXXX` (np. klucz
 * API wklejony przez pomyłkę) nie trafia do HTML - zostaje stała wdrożenia.
 * „Odłącz GA4" w panelu (`ga4_enabled: false`) wyłącza tag w SSR; bootstrap
 * kliencki (`ConsentScriptInjector`) dopina się do TEGO strumienia, więc SSR
 * i klient nigdy nie konfigurują dwóch różnych. Dokument jest cache'owany na
 * brzegu, więc zmiana w panelu dochodzi z opóźnieniem `s-maxage` dokumentu.
 */
/**
 * `head()` jest deklarowany PRZED `loader` w tym samym literale, więc TypeScript
 * nie zna jeszcze typu `loaderData` (widzi `never`). Czytamy więc pole przez
 * jawne zawężenie z `unknown` - bez `any` i bez rzutowania na kształt trasy.
 */
function ssrGoogleTagFromLoaderData(loaderData: unknown): SsrGoogleTag {
  if (loaderData === null || typeof loaderData !== "object") return DEFAULT_SSR_GOOGLE_TAG;
  const tag = (loaderData as { ga4?: unknown }).ga4;
  if (tag === null || typeof tag !== "object") return DEFAULT_SSR_GOOGLE_TAG;
  const { measurementId, enabled } = tag as { measurementId?: unknown; enabled?: unknown };
  if (typeof measurementId !== "string" || typeof enabled !== "boolean") {
    return DEFAULT_SSR_GOOGLE_TAG;
  }
  return { measurementId, enabled };
}

function ssrGoogleTag(settings: Readonly<Record<string, unknown>> | undefined): SsrGoogleTag {
  const analytics = resolveSetting(
    settings,
    "analytics",
    defaultAnalyticsConfig(),
    AnalyticsConfigSchema,
  );
  if (analytics.ga4_enabled === false) return { measurementId: "", enabled: false };
  return {
    measurementId: asGa4MeasurementId(analytics.ga4_measurement_id) || ROOT_GA4_ID,
    enabled: true,
  };
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Język renderu idzie za adresem przy KAŻDEJ nawigacji klienta, także
  // wstecz/dalej przeglądarki. Stało to w loaderze, a loader korzenia przy
  // nawigacji klienta nie biegnie ponownie (dopasowanie korzenia "zostaje"
  // i router-core uznaje je za świeże) - po powrocie z /en/x na /y strona
  // o polskim adresie kanonicznym renderowała się po angielsku. `beforeLoad`
  // biegnie przy każdym `router.load()`, przed loaderami i renderem trasy.
  // Na serwerze to czysty odczyt (żadnej mutacji współdzielonego singletona).
  // PRZED `head()`: TypeScript wnioskuje typ `beforeLoad` z kolejnych funkcji
  // literału, a `head` czyta kontekst trasy, który od niego zależy.
  beforeLoad: async ({ location }) => {
    await syncI18nToRequest(location.publicHref).catch(() => undefined);
  },
  head: (ctx) => {
    // Tag Google z loaderData (patrz `ssrGoogleTag`); bez loaderData (render
    // błędu, wywołanie bez kontekstu) - stała wdrożenia.
    const googleTag = ssrGoogleTagFromLoaderData(ctx?.loaderData);
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
        {
          name: "viewport",
          content:
            "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
        },
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
      scripts: [
        // Tag Google w SSR - SAM SNIPPET, BEZ `<script src>`. Warstwa danych,
        // tryb domyślnej odmowy i konfiguracja obu miejsc docelowych (GA4 +
        // Google Ads) jadą w pierwszym bajcie HTML, inline, za ~1,3 kB i zero
        // żądań: bez zgody nie powstają cookies, a decyzję odwiedzającego
        // aplikuje `ga4ConsentUpdate` (ConsentScriptInjector).
        //
        // SAM gtag.js ZSZEDŁ STĄD ZA BEZCZYNNOŚĆ (audyt CWV 2026-09-20, F20 /
        // plan 3.3). Był to jedyny obcy origin w `<head>`, bez `preconnect`,
        // ~90 KB parse+execute - a `src/router.tsx` czeka `setTimeout(0)` przed
        // hydratacją, więc makrozadanie hydratacji stawało ZA nim. Dociąga go
        // `ConsentScriptInjector` wg polityki z `lib/analytics/gtagLoadPolicy.ts`
        // (2026-10-02): przy pierwszej interakcji, przy zapisanej decyzji o
        // zgodzie albo po `load` i okresie bez długich zadań (limit 8 s);
        // polecenia z tego okna czekają w `window.dataLayer` (natywna kolejka
        // gtag.js), więc ani zgoda, ani pierwsza odsłona nie giną.
        // Hosty Google zostają w CSP (`start.ts`) - skrypt nadal się wczytuje,
        // tylko później.
        ...(googleTag.enabled
          ? [{ children: ga4SsrSnippet(googleTag.measurementId, GOOGLE_ADS_ID) }]
          : []),
        { type: "speculationrules", children: speculationRulesJson() },
      ],
    };
  },
  // Prefetch the entire site_settings bulk map on the server. The same query
  // backs Header, Footer, navigation menus, AlertBar and CopyrightBar - one
  // round-trip on the edge hydrates every layout chunk so chrome renders
  // in lockstep with the route body instead of popping in after hydration.
  loader: async ({ context, location }) => {
    const path = location.pathname;
    // Strona główna w KAŻDYM języku to "/": rewrite `input` routera
    // (`src/router.tsx`) zdejmuje prefiks "/en" ZANIM powstanie `location`, więc
    // dawne porównania z "/en" i "/en/" nigdy nie były prawdziwe.
    const isHome = path === "/";
    const homeDeadline = isServer && isHome ? homeSsrDeadline(context.queryClient) : undefined;
    // 301 legacy/preview hosts of the hosting layer (see canonicalRedirect.ts)
    // to https://neweuropeanstrategies.com preserving path + query. Runs
    // server-side only; editor preview (id-preview--*, EDITOR_HOST_SUFFIXES) and
    // localhost are excluded so the builder iframe keeps working.
    enforceCanonicalHost();
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
    // OD P2.1 hint modułu z loadera trafia do zestawu bootu (`#nes-boot-set`,
    // `lib/boot/bootSet.server.ts` czyta akumulator `Link` w dehydratacji):
    // dokument po LCP (`/`, `/$`) nie niesie go w odpowiedzi, dokument `now`
    // niesie go razem z całą serią (`lib/http/frameworkPreloads.server.ts`).
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
    const showsChrome = showsSiteChrome(path);
    // `.catch(() => null)` przy starcie, nie przy zbieraniu: obietnica leci
    // w tle przez całą pierwszą falę i nieobsłużone odrzucenie w tym oknie
    // wywróciłoby proces renderu.
    const warmMenus = async () => {
      const { menuWithItemsQueryOptions } = await import("../lib/menus/queries");
      await Promise.allSettled(
        ["main", "footer"].map((key) =>
          context.queryClient.ensureQueryData(menuWithItemsQueryOptions(key)),
        ),
      );
    };
    if (showsChrome) void warmMenus().catch(() => null);

    // FALA 1 - wyłącznie to, czego render nie ma czym zastąpić.
    //
    // `postLayoutSettings` NIE JEST tu już ROZGRZEWANE SIECIOWO: to OSOBNY klucz
    // `edgeTtlCache("post_layout_settings:row")`, czyli osobny round-trip na
    // każdej trasie publicznej. Trasa wpisu/strony grzeje go sobie sama
    // (`routes/$.tsx`), a tu zostaje wyłącznie ZASIEW DOMYŚLNYCH (niżej) -
    // za zero round-tripów.
    //
    // PO CO MIMO TO ZASIEW (niżej) - uzasadnienie przepisane 2026-09-20, bo
    // poprzednie przestało być prawdziwe. Stało tu, że bez wpisu w cache'u
    // `ContentAreaStyle` emituje w SSR DOSŁOWNIE ZERO BAJTÓW; tak było, dopóki
    // komponent miał gałąź `return null`. Naprawa F29a ją usunęła: bez wiersza
    // komponent emituje dziś pełny blok z `defaultPostLayoutSettings()`
    // (`components/ContentAreaStyle.tsx`, wzorzec `ThemeFontSizesStyle`), więc
    // odstępy akapitów i typografia linków są w pierwszym malowaniu NIEZALEŻNIE
    // od tego zasiewu.
    //
    // Zasiew zostaje z dwóch powodów, i żaden z nich nie jest kosmetyczny.
    // (1) PARYTET SSR/KLIENT. Komponent i zasiew biorą TĘ SAMĄ stałą
    // `defaultPostLayoutSettings()`, więc wpis w cache'u nie może rozjechać
    // serwerowego i klienckiego renderu - a zasiew przesądza, że pierwszy render
    // klienta czyta dokładnie to, co wypisał serwer, zamiast przechodzić przez
    // `data === undefined`. (2) WARTOŚCI NAJEMCY. Zasiew jest
    // PRZETERMINOWANY (`updatedAt: 0`), więc klient dociąga wiersz z bazy
    // natychmiast po hydratacji; bez wpisu zapytanie i tak by wystartowało, ale
    // cache korzenia nie niósłby żadnej informacji o tym kluczu do dehydracji.
    //
    // Zasiew niżej kosztuje ZERO round-tripów i jest PRZYWRÓCENIEM stanu
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
    // TERMIN FALI 1 - trzy rozłączne kontrakty: strona główna (wspólny deadline
    // renderu docięty `HOME_THEME_BUDGET_MS`), dokument bez serwerowego renderu
    // (uzasadnienie i wartość: `lib/routing/clientOnlyDocument.ts`), reszta
    // serwisu bez zmian. Trzeci argument `withBudget` może budżet wyłącznie
    // SKRÓCIĆ, więc żaden wariant nie podnosi sufitu pilnowanego przez
    // `check:ssr-budgets`.
    // Czwarty kontrakt (plan 1.4): powierzchnia Z chrome'em, ale BEZ
    // serwerowego renderu treści (profil, sieć, checkout - widok rozstrzyga
    // sesja po hydratacji). Fala 1 maluje tu tylko nagłówek i stopkę, więc nie
    // czeka pełnych 2 500 ms na dane, z których nie powstanie treść.
    const chromeOnly = isServer && homeDeadline === undefined && isChromeOnlyDocument(path);
    const themeDeadline =
      homeDeadline !== undefined
        ? Math.min(homeDeadline, Date.now() + HOME_THEME_BUDGET_MS)
        : isServer && isClientOnlyDocument(path)
          ? Date.now() + CLIENT_ONLY_WARM_BUDGET_MS
          : chromeOnly
            ? Date.now() + CHROME_ONLY_WARM_BUDGET_MS
            : undefined;
    await withBudget(
      Promise.allSettled([
        context.queryClient.ensureQueryData(siteSettingsQueryOptions),
        context.queryClient.ensureQueryData(designTokensQueryOptions),
        context.queryClient.ensureQueryData(globalColorsQueryOptions),
      ]),
      ROOT_WARM_BUDGET_MS,
      themeDeadline,
    );
    // Only homepage SSR opts into early cancellation. Another route may be
    // awaiting this same settings promise and retains its existing contract.
    if (homeDeadline !== undefined) {
      for (const queryKey of [
        siteSettingsQueryOptions.queryKey,
        designTokensQueryOptions.queryKey,
        globalColorsQueryOptions.queryKey,
      ]) {
        if (!hasSsrQueryData(context.queryClient, queryKey)) {
          setCacheControlHeader(resilientCacheControl(true));
          await context.queryClient.cancelQueries({ queryKey, exact: true }).catch(() => undefined);
        }
      }
    }
    // Termin chrome-only minął bez ustawień: nagłówek pójdzie na domyślnych
    // (zasiew niżej), a taki dokument nie ma prawa utrwalić się na brzegu.
    if (chromeOnly && !hasSsrQueryData(context.queryClient, siteSettingsQueryOptions.queryKey)) {
      setCacheControlHeader(resilientCacheControl(true));
    }
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
    // `ContentAreaStyle` radzi sobie dziś bez niego (emituje blok z tej samej
    // stałej), więc zasiew nie ratuje już pierwszego malowania - trzyma PARYTET
    // SSR/KLIENT na jednej wartości. `{ updatedAt: 0 }` znaczy, że klient i tak
    // dociągnie wartości najemcy natychmiast po hydratacji - domyślne są tu
    // pierwszym malowaniem, nie ostatnim słowem.
    const postLayoutKey = postLayoutSettingsQueryOptions().queryKey;
    if (!context.queryClient.getQueryData(postLayoutKey)) {
      context.queryClient.setQueryData(postLayoutKey, defaultPostLayoutSettings(), {
        updatedAt: 0,
      });
      // LISTA CELOWYCH ZASIEWÓW (P3.6b): predykat kompletności dokumentu
      // (`trackSsrQueryCompleteness`) liczy każdy zasiew z `updatedAt: 0` jako
      // zgubione dane - poza zadeklarowanymi tutaj. Ten zasiew nie jest
      // fallbackiem awarii, tylko parytetem SSR/klienta (uzasadnienie wyżej).
      // `import.meta.env.SSR`, nie `isServer`: Vite podmienia go na stałą, więc
      // wywołanie znika z bootu klienta (`isServer` z router-core nie zwija się).
      if (import.meta.env.SSR) markDeliberateSeed(context.queryClient, postLayoutKey);
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
        twitterCard: seo.twitter_card_type,
      });
      // Redakcyjny tytuł i opis serwisu (/admin/settings/site-identity) - ta
      // sama droga: pamięć kluczowana hostem czytana przez buildRootHead()
      // i head() strony głównej.
      rememberBrandDefaults(getOrigin(), {
        title: { pl: seo.site_title_pl, en: seo.site_title_en },
        description: { pl: seo.site_description_pl, en: seo.site_description_en },
        // Nazwa serwisu (/admin/seo/homepage) - zasila `og:site_name` oraz
        // `WebSite.name`/`alternateName`, czyli linię nazwy w wynikach Google.
        name: seo.site_name,
        alternateName: seo.site_name_alternate,
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
        const chromeBudget =
          homeDeadline === undefined
            ? CHROME_WARM_BUDGET_MS
            : remainingHomeBudget(homeDeadline, CHROME_WARM_BUDGET_MS);
        const header = resolveSetting<HeaderSettings>(settings, "header", {});
        const trending = resolveActiveTickerConfig(header.trending);
        const headerVisible = !!header.builder_data?.sections?.length;
        // Chunki leniwych widgetów nagłówka: hinty modułów idą do serii bootu (ta sama
        // droga co słownik wyżej), więc nagłówek po boocie po LCP ma swoje widgety
        // w tym samym burście co wejście - warunek CLS 0 (werdykt boot-js C3).
        if (isServer && headerVisible && header.builder_data) {
          for (const hint of widgetPreloadHeaders(header.builder_data, 3)) appendLinkHeader(hint);
        }
        const chromeQueryKeys: QueryKey[] = [
          ["menu-with-items", "main"],
          ["menu-with-items", "footer"],
        ];
        // BANER `header_banner` - jedyny slot reklamowy renderowany przez samo
        // CHROME (`components/Header.tsx` -> `<AdZone position="header_banner">`;
        // pozostałe pozycje - `sidebar`, `top_of_post`, `mid_post`, `in_feed`,
        // `footer_slideup` - należą do treści trasy, nie do powłoki).
        //
        // `AdZone` zwraca `null` bez danych, a `AdContainer` rezerwuje wtedy
        // ZERO pikseli, więc 90 px banera NAD treścią dojeżdżało po hydratacji:
        // ~0,11 CLS, najdroższa pojedyncza pozycja audytu CWV 2026-09-20 (F26).
        // Rozgrzany klucz maluje baner już w SSR, a `HeaderSkeleton` czyta
        // dokładnie ten sam wpis (`useHeaderSkeletonProps`), więc szkielet i
        // realny nagłówek rezerwują tę samą wysokość.
        //
        // TYP STRONY TYLKO Z URL-a. `SiteChrome` liczy go przez
        // `adPageTypeForLocation(pathname, contentKind)`, a `contentKind`
        // pochodzi z `loaderData` trasy dopasowanej - korzeń go nie zna.
        // Grzejemy więc WYŁĄCZNIE wtedy, gdy sam adres rozstrzyga typ
        // (home/archive/category/tag/search/event); dla reszty wynikiem jest
        // "all", a pod tym adresem może stać zarówno trasa statyczna (gdzie
        // "all" byłoby trafne), jak i catch-all `$` z typem "post"/"page"
        // (gdzie rozgrzalibyśmy klucz, którego nikt nie czyta - round-trip za
        // nic na NAJCZĘŚCIEJ odwiedzanej powierzchni serwisu). Klucze wpisu
        // grzeje loader `$.tsx`: `adPlacementsQueryOptions("header_banner",
        // kind)` plus pozycje treści z `pageId`.
        const adPageType = adPageTypeForLocation(path, null);
        const headerAds =
          adPageType === "all" ? null : adPlacementsQueryOptions("header_banner", adPageType);
        if (headerVisible && trending.enabled !== false) {
          chromeQueryKeys.push(headerTickerQueryOptions(trending).queryKey);
        }
        const tickerWarm = () =>
          chromeBudget > 0 && headerVisible && trending.enabled !== false
            ? context.queryClient.ensureQueryData(headerTickerQueryOptions(trending))
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
        const chromeWarm: Array<() => Promise<unknown>> = [tickerWarm, warmMenus];
        // Reklama jest DEKORACJĄ i dlatego jej klucz NIE trafia do
        // `chromeQueryKeys`. Tamta lista rozstrzyga, czy dokument wolno utrwalić
        // na brzegu: nierozgrzany slot znaczyłby „dokument niekompletny" i
        // zbijał każdy taki render do `s-maxage=30` (albo `no-store`) - czyli
        // brak sprzedanej emisji kosztowałby cache CAŁEGO serwisu. Brak banera
        // degraduje wyłącznie rezerwację jego własnych 90 px, a tę i tak trzyma
        // `HeaderSkeleton` na podstawie tego samego (pustego) wpisu.
        if (headerAds) {
          chromeWarm.push(() => context.queryClient.ensureQueryData(headerAds));
        }
        // NAGŁÓWEK I STOPKA JEDNĄ PĘTLĄ, nie dwoma kopiami tego samego bloku.
        // Oba są pełnoprawnymi dokumentami buildera i dostają DOKŁADNIE tę samą
        // obsługę (klucze sekcji do listy świeżości + jedna rozgrzewka w budżecie
        // fali chrome), a kolejność - najpierw nagłówek - zostaje bez zmian.
        //
        // Scalenie ma też drugi, mierzalny skutek: `check:ssr-budgets` liczy
        // WYSTĄPIENIA zapisów do cache'u zapytań w loaderze
        // (`dehydrationWritesPerLoader`, sufit 11 = cena stanu dzisiejszego,
        // ZERO zapasu). Dwa identyczne wywołania `prefetchCachedRouteQueries`
        // zajmowały tam dwie pozycje za jedną robotę; jedno wywołanie zwalnia
        // miejsce dokładnie na rozgrzewkę banera wyżej - bez podnoszenia sufitu.
        for (const doc of [headerVisible ? header.builder_data : null, footerDoc]) {
          if (!doc?.sections?.length) continue;
          chromeQueryKeys.push(
            ...doc.sections.flatMap((section) =>
              sectionQueryOptionsList(section, lang).map((options) => options.queryKey),
            ),
          );
          if (chromeBudget > 0)
            chromeWarm.push(() =>
              prefetchCachedRouteQueries(context.queryClient, doc, lang, chromeBudget),
            );
        }
        const initialChromeWarmup = registerChromeWarmup(context.queryClient, {
          ready: () => chromeQueryKeys.every((key) => hasSsrQueryData(context.queryClient, key)),
          expired: () =>
            homeDeadline !== undefined &&
            remainingHomeBudget(homeDeadline, CHROME_WARM_BUDGET_MS) <= 0,
          // Dwa rodzaje degradacji, dwie polityki (lib/ssr/chromeWarmup.tsx):
          // `chrome` = dane powłoki dostrumieniują się po flushu shella, dokument
          // będzie kompletny - wolno go współdzielić KRÓTKO (s-maxage=30);
          // `failed` = rozgrzewka padła albo budżet wyczerpany - `no-store`.
          // Scalenie w `setCacheControlHeader` gwarantuje, że ostrzejsza wygrywa.
          markDegraded: (kind) =>
            setCacheControlHeader(
              kind === "failed" ? resilientCacheControl(true) : chromeDegradedCacheControl(),
            ),
          // STRONA GŁÓWNA PO TERMINIE (P3.6b, R2c): `warm` niżej jest związane
          // wspólnym terminem dokumentu (`chromeBudget`, `homeDeadline`), więc po
          // jego minięciu niczego już nie dogrzewa i bramka oznaczała `failed`
          // (pasek „Na czasie" doskakiwał po hydratacji, dokument szedł
          // `no-store`). Ta sama praca z budżetem bramki
          // (`HOME_CHROME_LATE_BUDGET_MS`, lib/ssr/chromeWarmup.tsx); reklama
          // jak w `warm`, bo `HeaderSkeleton` rezerwuje jej wysokość z tego wpisu.
          // Bramka `import.meta.env.SSR` (stała Vite), nie `isServer`: tylko ona
          // wycina to domknięcie z chunku wejściowego klienta (+298 B bootu).
          warmLate:
            import.meta.env.SSR && homeDeadline !== undefined
              ? (budgetMs: number) =>
                  withBudget(
                    Promise.allSettled([
                      warmMenus(),
                      headerVisible && trending.enabled !== false
                        ? context.queryClient.ensureQueryData(headerTickerQueryOptions(trending))
                        : undefined,
                      headerAds ? context.queryClient.ensureQueryData(headerAds) : undefined,
                      ...[headerVisible ? header.builder_data : null, footerDoc].map((doc) =>
                        doc?.sections?.length
                          ? prefetchCachedRouteQueries(context.queryClient, doc, lang, budgetMs)
                          : undefined,
                      ),
                    ]),
                    budgetMs,
                  )
              : undefined,
          warm: async () => {
            if (chromeBudget <= 0) return;
            await withBudget(
              Promise.allSettled(chromeWarm.map((work) => work())),
              CHROME_WARM_BUDGET_MS,
              homeDeadline,
            );
          },
        });
        // Content routes must carry navigation in the first shell. Otherwise
        // the pre-render sweep cancels this work and HeaderSkeleton later
        // grows by ~180 px (CMS artifact trace). The existing 500 ms budget
        // still bounds the wait. Homepage retains its shared deadline.
        if (isServer && homeDeadline === undefined) await initialChromeWarmup;
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
        setCacheControlHeader(resilientCacheControl(true));
      }
    }
    // Jedyne, co czyta loaderData korzenia: strumień GA4 dla tagu Google w
    // head() (`ssrGoogleTag`). Mapa ustawień celowo NIE wraca stąd - byłaby
    // serializowana drugi raz do dehydratowanego payloadu.
    return { ga4: ssrGoogleTag(settings) };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// Tekst skryptu zgód w bundlu przeglądarki byłby martwym ciężarem (~1 KB
// gzip): skrypt wykonał się z HTML-a, zanim wystartował jakikolwiek moduł.
// Serwer ma stałą, przeglądarka przepisuje TEN SAM napis z wykonanego już
// węzła - hydratacja widzi identyczną treść, a stała (z fragmentami
// `consent.ts`) zostaje poza zamknięciem bootu.
const getServerConsentInitScript = createIsomorphicFn()
  .server((): string | null => CONSENT_INIT_SCRIPT)
  .client((): string | null => null);
const SERVER_CONSENT_INIT_SCRIPT = getServerConsentInitScript();

function consentInitScript(): string {
  if (SERVER_CONSENT_INIT_SCRIPT !== null) return SERVER_CONSENT_INIT_SCRIPT;
  if (typeof document === "undefined") return "";
  return document.querySelector("script[data-consent-init]")?.textContent ?? "";
}

// Sonda bootu - ta sama doktryna co skrypt zgód wyżej (poprawka po Prove P2.1: sonda urosła
// o `__nesBootArm`, a jej literał siedział w chunku wejściowym, czyli w domknięciu bootu):
// wykonała się z HTML-a jako PIERWSZY skrypt dokumentu, więc przeglądarka przepisuje TEN SAM
// napis z węzła `script[data-nes-probe]`, a stała zostaje wyłącznie na serwerze.
const getServerBootProbeScript = createIsomorphicFn()
  .server((): string | null => BOOT_PROBE_SCRIPT)
  .client((): string | null => null);
const SERVER_BOOT_PROBE_SCRIPT = getServerBootProbeScript();

function bootProbeScript(): string {
  if (SERVER_BOOT_PROBE_SCRIPT !== null) return SERVER_BOOT_PROBE_SCRIPT;
  if (typeof document === "undefined") return "";
  return document.querySelector("script[data-nes-probe]")?.textContent ?? "";
}

// Loader bootu (P2.1) - ta sama doktryna co skrypt zgód wyżej: serwer ma stałą, przeglądarka
// przepisuje TEN SAM napis z wykonanego już węzła `script[data-nes-boot]`. Loader wykonał się
// z HTML-a, zanim wystartował jakikolwiek moduł (to on wstawia wejście), więc literał w bundlu
// przeglądarki byłby martwym ciężarem domknięcia bootu, a hydratacja i tak widzi identyczną
// treść. Wyzwalacze i kontrakt: `lib/boot/bootLoaderScript.ts`.
const getServerBootLoaderScript = createIsomorphicFn()
  .server((): string | null => BOOT_LOADER_SCRIPT)
  .client((): string | null => null);
const SERVER_BOOT_LOADER_SCRIPT = getServerBootLoaderScript();

function bootLoaderScript(): string {
  if (SERVER_BOOT_LOADER_SCRIPT !== null) return SERVER_BOOT_LOADER_SCRIPT;
  if (typeof document === "undefined") return "";
  // Literał atrybutu, nie `BOOT_LOADER_ATTR`: import stałej trzymałby moduł loadera (z tekstem)
  // w grafie przeglądarki. Ta sama nazwa co `BOOT_LOADER_ATTR` (węzeł serwera sprawdza
  // `rootRoute.test.tsx`).
  return document.querySelector("script[data-nes-boot]")?.textContent ?? "";
}

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
        <script data-nes-probe="" dangerouslySetInnerHTML={{ __html: bootProbeScript() }} />
        {/* Loader bootu (P2.1) zaraz po sondzie: manifest Start nie startuje już JS-a, więc to
            ten skrypt wstawia serię `modulepreload` i wejście - po wpisie LCP kandydata na
            stronach z kandydatem, od razu wszędzie indziej (zestaw `#nes-boot-set` wstrzykuje
            serwer poza drzewem Reacta, `lib/boot/bootSet.server.ts`). Klasyczny i inline,
            bo musi działać przed każdym modułem. */}
        <script data-nes-boot="" dangerouslySetInnerHTML={{ __html: bootLoaderScript() }} />
        {supabaseConfigScript ? (
          <script dangerouslySetInnerHTML={{ __html: supabaseConfigScript }} />
        ) : null}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Zgody PRZED pierwszym malowaniem (P1.3): `html[data-consent-decided]`
            ukrywa powłokę banera odwiedzającemu z zapisaną decyzją, a
            delegowany `click` utrwala decyzję klikniętą w powłoce - także
            przed bootem. Reguła ważności i serializator rekordu pochodzą z
            `lib/ads/consent.ts`; kontrakt w `lib/consent/consentInitScript.ts`. */}
        <script data-consent-init="" dangerouslySetInnerHTML={{ __html: consentInitScript() }} />
        {/* Rezerwacja dolnej krawędzi PRZED pierwszym malowaniem.
            Pasek przestrzeni roboczej członka jest `position: fixed` przy
            dolnej krawędzi, a pojawia się PÓŹNO: sesja Supabase rozstrzyga
            się w efekcie, potem trzeba dociągnąć leniwą powłokę doku,
            i tylko wtedy biegnie pomiar. Bez tego skryptu dół strony
            podskakuje sekundy po pierwszym malowaniu, a CLS nalicza się
            przez całe życie strony.
            Skrypt odtwarza rezerwację z wysokości ZMIERZONEJ przy poprzednim
            wejściu. NIE czyta stanu uwierzytelnienia - wyłącznie liczbę
            pikseli własnego paska; kontrakt, limity i czyszczenie przy
            wylogowaniu opisuje `lib/dock/reservedSpace.ts`. */}
        <script dangerouslySetInnerHTML={{ __html: DOCK_RESERVE_INIT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// Consent resolves after hydration. Keep its subscription below the root so
// this background update cannot recreate every provider value and interrupt
// hydration of the already visible article's lazy widgets.
function ClientObservability() {
  const { categories, mounted: consentMounted } = useEffectiveConsent();

  // Client observability (Core Web Vitals RUM + global error capture) is
  // analytics data - gate it on the visitor's analytics consent and tear it
  // down if consent is withdrawn (mirrors ConsentScriptInjector). Nothing is
  // beaconed before an explicit opt-in, so no telemetry is collected without
  // consent (RODO/GDPR).
  useEffect(() => {
    if (!consentMounted || !categories.analytics) return;
    const background = createBackgroundScope();
    // Prerender (Speculation Rules) nie jest wizytą: telemetria startuje
    // dopiero przy aktywacji strony, inaczej hover zawyżałby RUM.
    const stopPrerenderWait = afterPrerendering(() => {
      void background.run(import("../lib/observability"), (m) => {
        return m.initObservability();
      });
    });
    return () => {
      background.dispose();
      stopPrerenderWait();
    };
  }, [consentMounted, categories.analytics]);

  return null;
}

/** Overlay readiness changes independently from the page. Keeping these
 * subscriptions here avoids rerendering the router, theme and content tree
 * every time a deferred overlay becomes ready. */
function DeferredRootOverlays() {
  // Bramki nakładek (F19) - patrz `useOverlayGates` / `useToasterWanted`.
  // Wszystkie startują na `false`, czyli SSR i pierwszy render klienta emitują
  // dokładnie to samo (null), a `React.lazy` nie startuje `import()` w commicie
  // hydratacji.
  const { overlaysReady } = useOverlayGates();
  const toasterWanted = useToasterWanted();
  const consentPreviewRequested = useConsentPreviewRequested();
  const noActivePopups = useNoActivePopupsFromSsr();

  return (
    <>
      {/* Baner zgód: powłoka SSR od pierwszego malowania, interaktywny baner
          po interakcji - nigdy WARUNKOWY (patrz `ConsentSurface`). Poza
          granicą `Suspense` niżej, żeby zawieszenie sąsiada nie ukryło powłoki. */}
      <ConsentSurface />
      <Suspense fallback={null}>
        {/* Panel podglądu zgód dociągał swój chunk na KAŻDEJ stronie, choć
                renderuje cokolwiek wyłącznie przy `?consent-preview=1`
                (`isConsentPreviewRequested`). Ten sam warunek, tylko
                PRZED montażem - dla zwykłego czytelnika chunk nie powstaje. */}
        {consentPreviewRequested ? <ConsentPreviewPanel /> : null}
        {overlaysReady ? <NewsletterPopup /> : null}
        {overlaysReady && !noActivePopups ? <PopupHost /> : null}
      </Suspense>
      <Suspense fallback={null}>{toasterWanted ? <Toaster /> : null}</Suspense>
    </>
  );
}

/**
 * Wczesny filtr chunk-load errors - NADZBIÓR `looksLikeChunkLoadError`
 * z `lib/cacheBusting.ts` dla błędów, jakie zgłaszają przeglądarki i Vite
 * (`Error` albo napis; dwa wzorce „…dynamically imported module" zwinięte
 * w jeden). Kopia, bo moduł cache-bustingu NIE może wejść do zamknięcia bootu,
 * a filtr działa, zanim ten moduł się załaduje; moduł i tak sprawdza błąd
 * ponownie (`handleChunkLoadFailure`). Parytet: `rootRoute.test.tsx`.
 */
const EARLY_CHUNK_LOAD_ERROR =
  /ChunkLoadError|Loading chunk [\w-]+ failed|dynamically imported module|Importing a module script failed/i;

type CacheBustingModule = Pick<
  typeof import("../lib/cacheBusting"),
  "startCacheBusting" | "handleChunkLoadFailure"
>;
type QuiescenceModule = Pick<typeof import("../lib/performance/whenQuiescent"), "onQuiescent">;

/**
 * Cache-busting (P1.3, TP-4): import modułu w PUNKCIE CISZY P0.3 (`onQuiescent`,
 * klasa `overlays`) - setup pollingu nie ma żadnej pilności, a jego chunk
 * i fetch lądowały w śladzie Lighthouse'a; poll `/api/public/version` jest na
 * liście ignorowanych detektora ciszy, więc nie przesuwa punktu innym
 * konsumentom. Prymityw ciszy też dociągamy `import()` - poza zamknięciem
 * bootu.
 *
 * SIATKA BEZPIECZEŃSTWA NIE CZEKA NA CISZĘ: chunk-load error przed punktem
 * ciszy (np. leniwy chunk usunięty przez wdrożenie przy dokumencie z cache
 * brzegowego) ściąga moduł od razu i oddaje mu ten błąd
 * (`handleChunkLoadFailure`) - przeładowanie działa tak wcześnie jak dotąd.
 * Każdy INNY błąd (pętla ResizeObserver, skrypt strony trzeciej, odrzucony
 * fetch) jest pomijany: nie może wciągać chunku do śladu (recenzja P1.3, D1).
 * Moduł po starcie zakłada własny nasłuch, więc późniejsze błędy obsługuje sam.
 *
 * `load`/`loadQuiet` - wyłącznie dla testu (atrapy modułów); domyślnie dosłowne
 * `import()`, żeby bundler wydzielił oba moduły do leniwych chunków.
 */
export function armCacheBusting(
  background: { run: ReturnType<typeof createBackgroundScope>["run"] },
  router: Parameters<CacheBustingModule["startCacheBusting"]>[0],
  load: () => Promise<CacheBustingModule> = () => import("../lib/cacheBusting"),
  loadQuiet: () => Promise<QuiescenceModule> = () => import("../lib/performance/whenQuiescent"),
): () => void {
  const earlyErrors: unknown[] = [];
  let disposed = false;
  let started: Promise<void> | null = null;
  let cancelQuiet: () => void = () => {};
  const stopEarlyErrors = () => {
    window.removeEventListener("error", onEarlyError);
    window.removeEventListener("unhandledrejection", onEarlyRejection);
  };
  const start = (): Promise<void> => {
    started ??= background.run(load(), (m) => {
      stopEarlyErrors();
      const stop = m.startCacheBusting(router);
      for (const reason of earlyErrors.splice(0)) m.handleChunkLoadFailure(reason);
      return stop;
    });
    return started;
  };
  const early = (reason: unknown) => {
    const text =
      typeof reason === "string" ? reason : reason instanceof Error ? reason.message : "";
    if (!EARLY_CHUNK_LOAD_ERROR.test(text)) return;
    earlyErrors.push(reason);
    void start();
  };
  function onEarlyError(event: ErrorEvent) {
    early(event.error ?? event.message);
  }
  function onEarlyRejection(event: PromiseRejectionEvent) {
    early(event.reason);
  }
  window.addEventListener("error", onEarlyError);
  window.addEventListener("unhandledrejection", onEarlyRejection);
  void loadQuiet().then(
    ({ onQuiescent }) => {
      if (!disposed) cancelQuiet = onQuiescent(start, { priority: "overlays" });
    },
    () => void start(),
  );
  return () => {
    disposed = true;
    stopEarlyErrors();
    cancelQuiet();
  };
}

function RootComponent() {
  const router = useRouter();

  useEffect(() => {
    const background = createBackgroundScope();
    // Preview iframe watchdog: reload when the editor preview hangs on boot
    // or the main thread freezes for too long. No-op outside iframes - dlatego
    // ten sam test co wewnątrz modułu wykonujemy PRZED importem: produkcyjny
    // czytelnik (poza iframe'em edytora) nie pobiera i nie parsuje chunku,
    // który i tak zrobiłby no-op w oknie tuż po hydratacji.
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
      void background.run(import("../lib/watchdog/previewWatchdog"), (m) => {
        return m.startPreviewWatchdog();
      });
    }
    // Attribute Web Vitals to the correct subpage on soft navigations
    // (kategorie, wpisy, strony statyczne). Flush the previous path's
    // accumulators before switching so LCP/CLS/INP land per URL.
    let lastPath = typeof window !== "undefined" ? window.location.pathname : "/";
    const unsub = router.subscribe("onResolved", () => {
      void background.run(import("../lib/webVitals"), (m) => {
        const nextPath = window.location.pathname;
        if (nextPath !== lastPath) {
          m.markWebVitalsPage(nextPath);
          lastPath = nextPath;
        }
      });
      // Silnik analityki: page_view przy każdym rozwiązanym routingu
      // (SPA + first paint). Fire-and-forget, respektuje zgodę analytics.
      void background.run(import("../lib/analytics/track"), (m) => {
        m.trackPageView();
      });
    });

    // Cache-busting: chunk-load errors -> jednorazowy hard reload; polling
    // /api/public/version -> miękkie odświeżenie przy nowym wdrożeniu. Import
    // w punkcie ciszy P0.3, siatka wczesnych błędów - `armCacheBusting` niżej.
    const disarmCacheBusting = armCacheBusting(background, router);

    // Heartbeat sesji podglądu: iframe podglądu potrafi stracić połączenie z
    // sandboxem (uśpienie, przebudowa po merge, restart dev servera) i zostaje
    // biały aż do ręcznego „Reload preview". Ten moduł wykrywa milczenie pulsu
    // > 30 s, sam prosi powłokę o wznowienie, a w ostateczności przeładowuje
    // dokument z odtworzeniem trasy i pozycji scrolla.
    //
    // BRAMKA PRZED IMPORTEM, nie w środku modułu - ta sama poprawka, co przy
    // `previewWatchdog` wyżej i z tego samego powodu (audyt CWV 2026-09-20,
    // F23). `startPreviewHeartbeat` zaczyna od `isPreviewContext(location,
    // window.parent !== window)`, a TA FUNKCJA WYCHODZI NA `false` DLA
    // WSZYSTKIEGO, CO NIE JEST IFRAME'EM - czyli produkcyjny czytelnik pobierał
    // i parsował 294 linie po to, żeby zrobić no-op. Powtarzamy tu wyłącznie
    // pierwszy warunek tamtej funkcji (iframe), więc bramka nie może być
    // OSTRZEJSZA od modułu: każdy kontekst, w którym heartbeat ma sens,
    // jest iframe'em, a resztę decyzji (host) nadal podejmuje moduł.
    const cancelHeartbeatIdle = inPreviewIframe
      ? whenIdle(() => {
          void background.run(import("../lib/preview/sessionHeartbeat"), (m) => {
            return m.startPreviewHeartbeat(router);
          });
        }, 3000)
      : null;

    return () => {
      background.dispose();
      unsub();
      disarmCacheBusting();
      cancelHeartbeatIdle?.();
    };
  }, [router]);

  // Per-request i18next instance on the server (isolates the render language
  // from concurrent requests); the shared singleton on the client. Rendered
  // once per request on the server, so a mount-stable memo is correct.
  const renderI18n = useMemo(() => getRenderI18n(), []);

  return (
    <I18nextProvider i18n={renderI18n}>
      <ClientObservability />
      <ThemeProvider>
        <AuthProvider>
          <IconPackSync />
          <AuthenticatedLiveSync />
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
          <DeferredRootOverlays />
          <LoginPopupHost />
          <CommandPaletteHost />
          <UnsavedChangesGuardHost />
          <AppDialogHost />
          <ExpertRequestDialogHost />
        </AuthProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
