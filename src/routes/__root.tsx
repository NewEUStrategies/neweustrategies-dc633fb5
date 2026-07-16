import { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Suspense, useEffect, useMemo, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import appCss from "../styles.css?url";
// Fingerprinted by Vite to the SAME emitted file the @font-face in styles.css
// references, so the preload is reused (not a second download). See styles.css.
import redHatDisplayLatin from "../assets/fonts/red-hat-display-latin.woff2?url";
import redHatDisplayLatinExt from "../assets/fonts/red-hat-display-latin-ext.woff2?url";
import { fontPreloadLinks } from "../lib/seo/fontPreload";
import { buildRootHead, feedDiscoveryLinks } from "../lib/seo/meta";
import { getOrigin } from "../lib/seo/request";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { syncI18nToRequest, getRenderI18n } from "../lib/i18n";
import { supabasePublicConfigScript } from "../lib/supabasePublicConfig";
import { currentLang } from "../lib/i18n/localeRuntime";
import { errorCopy } from "../lib/errorCopy";
import "../lib/i18n-profile";
import { ThemeProvider } from "../components/ThemeProvider";
import { AuthProvider } from "../hooks/useAuth";
import { Toaster } from "../components/ui/sonner";
import { IconPackSync } from "../components/IconPackSync";
import { DesignTokensStyle } from "../components/DesignTokensStyle";
import { ContentAreaStyle } from "../components/ContentAreaStyle";
import { ThemeOptionsStyle } from "../components/ThemeOptionsStyle";
import { ThemeDesignStyle } from "../components/theme/ThemeDesignStyle";
import { ThemeFontSizesStyle } from "../components/theme/ThemeFontSizesStyle";
import { ConsentBanner } from "../components/ConsentBanner";
import { ConsentScriptInjector } from "../components/ConsentScriptInjector";
import { ConsentPreviewPanel } from "../components/ConsentPreviewPanel";
import { LocalePreferenceRedirect } from "../components/LocalePreferenceRedirect";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { WidgetLiveSync } from "../lib/builder/widgetCacheInvalidation";
import { SiteSettingsLiveSync } from "../lib/builder/siteSettingsLiveSync";
import { CohesionLiveSync } from "../lib/realtime/cohesionLiveSync";
import { resolveSetting, siteSettingsQueryOptions } from "../lib/useSiteSetting";
import { headerTickerQueryOptions } from "../lib/views/headerTickerQuery";
import { resolveActiveTickerConfig } from "../lib/views/tickerVariants";
import { designTokensQueryOptions } from "../lib/builder/designTokens";
import { globalColorsQueryOptions } from "../hooks/useGlobalColors";
import { postLayoutSettingsQueryOptions } from "../hooks/usePostLayoutSettings";
import type { HeaderSettings } from "../components/Header";
import { SiteChrome } from "../components/SiteChrome";
import { GlobalAudioPlayerProvider } from "../lib/audio/global-player";
import { GlobalAudioBar } from "../components/audio/GlobalAudioBar";
import { UnsavedChangesGuardHost } from "../components/UnsavedChangesGuardHost";
import { AppDialogHost } from "../components/AppDialogHost";
import { LoginPopup } from "../components/LoginPopup";
import { NewsletterPopup } from "../components/NewsletterPopup";
import { CommandPalette } from "../components/search/CommandPalette";
import { PopupHost } from "../components/popups/PopupHost";

function NotFoundComponent() {
  const copy = errorCopy();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{copy.notFoundTitle}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{copy.notFoundBody}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {copy.goHome}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  const copy = errorCopy();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{copy.errorTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{copy.errorBody}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {copy.tryAgain}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {copy.goHome}
          </a>
        </div>
      </div>
    </div>
  );
}

function RouteLoadingSkeleton() {
  // skeleton-shimmer (styles.css) reads as active progress instead of an idle
  // pulse - perceived speed during slow (>500ms) route transitions.
  return (
    <div className="min-h-[55vh] w-full px-4 py-8 lg:px-8" aria-busy="true">
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
      meta: buildRootHead(lang),
      // Red Hat Display is self-hosted via @font-face in styles.css (see there),
      // so no Google Fonts stylesheet / preconnect is needed - one fewer
      // render-blocking third-party request, and no visitor IPs sent to Google.
      links: [
        { rel: "stylesheet", href: appCss },
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
        // RSS autodiscovery for both language feeds, on every page - feed
        // readers and crawlers find the feeds regardless of the entry URL.
        ...feedDiscoveryLinks(getOrigin()),
      ],
    };
  },
  // Prefetch the entire site_settings bulk map on the server. The same query
  // backs Header, Footer, navigation menus, AlertBar and CopyrightBar - one
  // round-trip on the edge hydrates every layout chunk so chrome renders
  // in lockstep with the route body instead of popping in after hydration.
  loader: async ({ context, location }) => {
    await syncI18nToRequest().catch(() => undefined);
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
    await Promise.allSettled([
      context.queryClient.ensureQueryData(siteSettingsQueryOptions),
      context.queryClient.ensureQueryData(designTokensQueryOptions),
      context.queryClient.ensureQueryData(globalColorsQueryOptions),
      context.queryClient.ensureQueryData(postLayoutSettingsQueryOptions()),
    ]);
    const settings = context.queryClient.getQueryData<Readonly<Record<string, unknown>>>(
      siteSettingsQueryOptions.queryKey,
    );
    // Warm the header "Na czasie" ticker for every route that shows the site
    // chrome, so the bar is part of the SSR HTML instead of appearing seconds
    // after hydration and pushing the whole page down (the worst CLS on the
    // site). Both fetches sit behind per-isolate TTL caches (see ssrCache /
    // postViews.functions), so in steady state this adds no extra round-trips.
    const path = location.pathname;
    const showsChrome =
      path !== "/admin" &&
      !path.startsWith("/admin/") &&
      path !== "/login" &&
      !path.startsWith("/login/");
    if (showsChrome) {
      try {
        const header = resolveSetting<HeaderSettings>(settings, "header", {});
        const trending = resolveActiveTickerConfig(header.trending);
        const headerVisible = !!header.builder_data?.sections?.length;
        if (headerVisible && trending.enabled !== false) {
          await context.queryClient.ensureQueryData(headerTickerQueryOptions(trending));
        }
      } catch {
        /* ticker is non-critical decoration - never let it block the site */
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
  useEffect(() => {
    // Consolidated client observability: Core Web Vitals (RUM) + global error
    // capture, beaconed to the configurable observability endpoint.
    void import("../lib/observability").then((m) => m.initObservability());
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
    });
    return () => {
      unsub();
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
          <LocalePreferenceRedirect />
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
              <GlobalAudioBar />
            </GlobalAudioPlayerProvider>
          </ErrorBoundary>
          <ConsentBanner />
          <ConsentScriptInjector />
          <ConsentPreviewPanel />
          <Suspense fallback={null}>
            <LoginPopup />
            <NewsletterPopup />
            <PopupHost />
            <CommandPalette />
          </Suspense>
          <UnsavedChangesGuardHost />
          <AppDialogHost />
          <Toaster />
        </AuthProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
