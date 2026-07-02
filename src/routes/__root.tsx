import { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
// Fingerprinted by Vite to the SAME emitted file the @font-face in styles.css
// references, so the preload is reused (not a second download). See styles.css.
import redHatDisplayLatin from "../assets/fonts/red-hat-display-latin.woff2?url";
import redHatDisplayLatinExt from "../assets/fonts/red-hat-display-latin-ext.woff2?url";
import { fontPreloadLinks } from "../lib/seo/fontPreload";
import { buildRootHead, feedDiscoveryLinks } from "../lib/seo/meta";
import { getOrigin } from "../lib/seo/request";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { syncI18nToRequest } from "../lib/i18n";
import { currentLang } from "../lib/i18n/localeRuntime";
import "../lib/i18n-profile";
import { ThemeProvider } from "../components/ThemeProvider";
import { AuthProvider } from "../hooks/useAuth";
import { Toaster } from "../components/ui/sonner";
import { IconPackSync } from "../components/IconPackSync";
import { DesignTokensStyle } from "../components/DesignTokensStyle";
import { ContentAreaStyle } from "../components/ContentAreaStyle";
import { ThemeOptionsStyle } from "../components/ThemeOptionsStyle";
import { ThemeDesignStyle } from "../components/theme/ThemeDesignStyle";
import { ConsentBanner } from "../components/ConsentBanner";
import { LocalePreferenceRedirect } from "../components/LocalePreferenceRedirect";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { WidgetLiveSync } from "../lib/builder/widgetCacheInvalidation";
import { SiteSettingsLiveSync } from "../lib/builder/siteSettingsLiveSync";
import { resolveSetting, siteSettingsQueryOptions } from "../lib/useSiteSetting";
import { headerTickerQueryOptions } from "../lib/views/headerTickerQuery";
import { designTokensQueryOptions } from "../lib/builder/designTokens";
import { globalColorsQueryOptions } from "../hooks/useGlobalColors";
import { postLayoutSettingsQueryOptions } from "../hooks/usePostLayoutSettings";
import type { HeaderSettings } from "../components/Header";
import { SiteChrome } from "../components/SiteChrome";

// Non-critical overlays: not visible at first paint (they open on trigger/delay),
// so they are code-split out of the entry to shrink the critical hydration bundle.
// Streaming SSR still resolves them server-side, so the rendered HTML is unchanged.
const LoginPopup = lazy(() => import("../components/LoginPopup").then((m) => ({ default: m.LoginPopup })));
const NewsletterPopup = lazy(() =>
  import("../components/NewsletterPopup").then((m) => ({ default: m.NewsletterPopup })),
);
const CommandPalette = lazy(() =>
  import("../components/search/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
const PopupHost = lazy(() =>
  import("../components/popups/PopupHost").then((m) => ({ default: m.PopupHost })),
);


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

function RouteLoadingSkeleton() {
  return (
    <main className="min-h-[55vh] w-full animate-pulse px-4 py-8 lg:px-8" aria-busy="true">
      <div className="mx-auto max-w-[1200px] space-y-6">
        <div className="h-5 w-40 rounded bg-muted" />
        <div className="h-10 w-2/3 max-w-2xl rounded bg-muted" />
        <div className="grid gap-5 md:grid-cols-3">
          <div className="md:col-span-2 space-y-4">
            <div className="aspect-[16/7] rounded-xl bg-muted" />
            <div className="h-4 w-full rounded bg-muted" />
            <div className="h-4 w-5/6 rounded bg-muted" />
          </div>
          <div className="space-y-3">
            <div className="h-24 rounded-xl bg-muted" />
            <div className="h-24 rounded-xl bg-muted" />
          </div>
        </div>
      </div>
    </main>
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
    await syncI18nToRequest();
    // Warm design tokens / global colors / post-layout in parallel with
    // site_settings so <DesignTokensStyle />, <ContentAreaStyle /> and
    // friends render their `<style>` server-side. Without this the first
    // paint uses raw styles.css defaults (dark navy fallback) and only
    // switches to the tenant palette after client-side hydration - a jarring
    // flash of unstyled theme.
    const [settings] = await Promise.all([
      context.queryClient.ensureQueryData(siteSettingsQueryOptions),
      context.queryClient.ensureQueryData(designTokensQueryOptions),
      context.queryClient.ensureQueryData(globalColorsQueryOptions),
      context.queryClient.ensureQueryData(postLayoutSettingsQueryOptions()),
    ]);
    // chrome, so the bar is part of the SSR HTML instead of appearing seconds
    // after hydration and pushing the whole page down (the worst CLS on the
    // site). Both fetches sit behind per-isolate TTL caches (see ssrCache /
    // postViews.functions), so in steady state this adds no extra round-trips.
    const path = location.pathname;
    const showsChrome =
      path !== "/admin" && !path.startsWith("/admin/") &&
      path !== "/login" && !path.startsWith("/login/");
    if (showsChrome) {
      const header = resolveSetting<HeaderSettings>(settings, "header", {});
      const trending = header.trending ?? {};
      const headerVisible = !!header.builder_data?.sections?.length;
      if (headerVisible && trending.enabled !== false) {
        await context.queryClient.ensureQueryData(headerTickerQueryOptions(trending));
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

const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark';document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

function RootShell({ children }: { children: ReactNode }) {
  const lang = currentLang();
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <HeadContent />
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
  useEffect(() => {
    // Consolidated client observability: Core Web Vitals (RUM) + global error
    // capture, beaconed to the configurable observability endpoint.
    void import("../lib/observability").then((m) => m.initObservability());
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>
        <LocalePreferenceRedirect />
        <IconPackSync />
        <WidgetLiveSync />
        <SiteSettingsLiveSync />
        <DesignTokensStyle />
        <ContentAreaStyle />
        <ThemeOptionsStyle />
        <ThemeDesignStyle />
        <ErrorBoundary>
          <SiteChrome>
            <Suspense fallback={<RouteLoadingSkeleton />}>
              <Outlet />
            </Suspense>
          </SiteChrome>
        </ErrorBoundary>
        <ConsentBanner />
        <Suspense fallback={null}>
          <LoginPopup />
          <NewsletterPopup />
          <PopupHost />
          <CommandPalette />
        </Suspense>
        <Toaster />
      </AuthProvider>
    </ThemeProvider>

  );
}

