import { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Suspense, useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import i18n, { syncI18nToRequest } from "../lib/i18n";
import "../lib/i18n-profile";
import { ThemeProvider } from "../components/ThemeProvider";
import { AuthProvider } from "../hooks/useAuth";
import { Toaster } from "../components/ui/sonner";
import { IconPackSync } from "../components/IconPackSync";
import { DesignTokensStyle } from "../components/DesignTokensStyle";
import { ContentAreaStyle } from "../components/ContentAreaStyle";
import { ThemeOptionsStyle } from "../components/ThemeOptionsStyle";
import { ThemeDesignStyle } from "../components/theme/ThemeDesignStyle";
import { LoginPopup } from "../components/LoginPopup";
import { ConsentBanner } from "../components/ConsentBanner";
import { NewsletterPopup } from "../components/NewsletterPopup";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { CommandPalette } from "../components/search/CommandPalette";
import { WidgetLiveSync } from "../lib/builder/widgetCacheInvalidation";
import { SiteSettingsLiveSync } from "../lib/builder/siteSettingsLiveSync";
import { siteSettingsQueryOptions } from "../lib/useSiteSetting";
import { SiteChrome } from "../components/SiteChrome";


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
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Lovable App" },
      { name: "description", content: "Lovable Generated Project" },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Lovable App" },
      { property: "og:description", content: "Lovable Generated Project" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    // Red Hat Display is self-hosted via @font-face in styles.css (see there),
    // so no Google Fonts stylesheet / preconnect is needed - one fewer
    // render-blocking third-party request, and no visitor IPs sent to Google.
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "dns-prefetch", href: "https://unnltowbgszpdzwpawdu.supabase.co" },
      { rel: "preconnect", href: "https://unnltowbgszpdzwpawdu.supabase.co", crossOrigin: "anonymous" },
    ],
  }),
  // Prefetch the entire site_settings bulk map on the server. The same query
  // backs Header, Footer, navigation menus, AlertBar and CopyrightBar - one
  // round-trip on the edge hydrates every layout chunk so chrome renders
  // in lockstep with the route body instead of popping in after hydration.
  loader: async ({ context }) => {
    await syncI18nToRequest();
    return context.queryClient.ensureQueryData(siteSettingsQueryOptions);
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark';document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

function RootShell({ children }: { children: ReactNode }) {
  const lang = i18n.language === "en" ? "en" : "pl";
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
        <LoginPopup />
        <ConsentBanner />
        <NewsletterPopup />
        <CommandPalette />
        <Toaster />
      </AuthProvider>
    </ThemeProvider>

  );
}

