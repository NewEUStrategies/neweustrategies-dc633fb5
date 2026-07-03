import { useTranslation } from "react-i18next";
import { useSuspenseQuery } from "@tanstack/react-query";
import { memo, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import type { BuilderDocument } from "@/lib/builder/types";
import type { TickerConfig } from "@/lib/views/headerTickerQuery";
import { AlertBar } from "@/components/AlertBar";
import { AdZone } from "@/components/AdSlot";
import { TrendingTicker } from "@/components/header/TrendingTicker";
import { HeaderSkeleton } from "@/components/header/HeaderSkeleton";
import { MobileDrawerBody } from "@/components/header/mobile/MobileDrawerBody";
import { AppLink } from "@/components/atoms/AppLink";
import { useRouterState } from "@tanstack/react-router";
import { useTheme } from "@/components/ThemeProvider";

type ThemeLogoCfg = {
  logo?: {
    main?: string;
    main_dark?: string;
    mobile?: string;
    mobile_dark?: string;
  };
};

// Shared with the root loader (SSR prefetch of the ticker) - keep in sync.
export type HeaderSettings = {
  builder_data?: BuilderDocument | null;
  trending?: TickerConfig;
};

type GeneralSettings = { site_name?: string };

function HeaderInner() {
  const { i18n, t } = useTranslation();
  const lang = i18n.language ?? "pl";
  const isPl = lang.startsWith("pl");

  // Loader in __root.tsx prefetches this query, so useSuspenseQuery resolves
  // synchronously on hydration and on every client navigation - the header
  // never flashes a skeleton in steady state.
  const { data: settingsMap } = useSuspenseQuery(siteSettingsQueryOptions);
  const cfg = resolveSetting<HeaderSettings>(settingsMap, "header", {});
  const general = resolveSetting<GeneralSettings>(settingsMap, "general", {});
  const theme = resolveSetting<ThemeLogoCfg>(settingsMap, "theme_options", {});
  const trending = cfg.trending ?? { enabled: true };
  const siteName = (general.site_name && general.site_name.trim()) || "Menu";
  const { theme: mode } = useTheme();
  const isDark = mode === "dark";
  const themeLogo = theme.logo ?? {};
  const mobileLogo = isDark
    ? themeLogo.mobile_dark || themeLogo.mobile || themeLogo.main_dark || themeLogo.main || ""
    : themeLogo.mobile || themeLogo.mobile_dark || themeLogo.main || themeLogo.main_dark || "";

  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  // Close the drawer on route change and lock body scroll while open.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    if (open) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!cfg.builder_data || !cfg.builder_data.sections?.length) return null;

  const openLabel = isPl ? "Otwórz menu" : "Open menu";
  const closeLabel = isPl ? "Zamknij menu" : "Close menu";
  const openA11y = t("nav.open", { defaultValue: openLabel });
  const closeA11y = t("nav.close", { defaultValue: closeLabel });

  return (
    <>
      <AlertBar />
      {trending.enabled !== false && (
        <TrendingTicker
          source={trending.source ?? "trending"}
          mode={trending.mode ?? "scroll"}
          days={trending.days ?? 7}
          limit={trending.limit ?? 8}
          intervalSec={trending.intervalSec ?? 6}
          pinnedPostId={trending.pinnedPostId}
          pinnedUntil={trending.pinnedUntil ?? null}
          fullWidth={trending.fullWidth ?? true}
        />
      )}
      <AdZone position="header_banner" pageType="all" className="py-2 text-center" />

      {/* Mobile compact bar: horizontal logo (super-admin -> Branding -> Logo -> Mobile) + hamburger. */}
      <div className="lg:hidden sticky top-0 z-[9998] grid grid-cols-[2.5rem_1fr_2.5rem] items-center gap-3 px-4 py-3 border-b border-border bg-background">
        <div />
        <AppLink
          href="/"
          aria-label={siteName}
          className="flex items-center justify-center min-w-0 text-foreground"
        >
          {mobileLogo ? (
            <img
              src={mobileLogo}
              alt={siteName}
              className="h-8 w-auto max-w-[220px] object-contain"
              loading="eager"
              decoding="async"
            />
          ) : (
            <span className="text-base font-bold tracking-tight truncate min-w-0">
              {siteName}
            </span>
          )}
        </AppLink>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={openA11y}
          aria-expanded={open}
          aria-controls="mobile-header-drawer"
          className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-border text-foreground hover:bg-muted transition shrink-0"
        >
          <Menu className="w-5 h-5" aria-hidden />
        </button>
      </div>

      {/* Full builder-authored header - visible from lg up. */}
      <div className="hidden lg:block">
        <BuilderRenderer doc={cfg.builder_data} lang={isPl ? "pl" : "en"} />
      </div>

      {/* Mobile/Tablet drawer: portalowany do <body>, żeby uciec ze stacking
          contextu <header> (view-transition-name). Zawartość składana z
          klocków wg konfiguracji zarządzanej przez super-admina. */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id="mobile-header-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={siteName}
            className="fixed inset-0 z-[9999] lg:hidden"
          >
            <button
              type="button"
              aria-label={closeA11y}
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in"
            />
            <div className="absolute inset-y-0 right-0 w-[min(88vw,360px)] bg-background shadow-2xl border-l border-border flex flex-col animate-in slide-in-from-right">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
                <span className="text-sm font-bold tracking-wider uppercase text-muted-foreground">
                  {isPl ? "Menu" : "Menu"}
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={closeA11y}
                  className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border text-foreground hover:bg-muted transition"
                >
                  <X className="w-5 h-5" aria-hidden />
                </button>
              </div>
              <MobileDrawerBody
                builderDoc={cfg.builder_data}
                isPl={isPl}
                onNavigate={() => setOpen(false)}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export const Header = memo(function Header() {
  return (
    <header
      data-site-header
      // z-40 lifts the header's stacking context (forced by
      // view-transition-name) above <main>'s, so the sticky mobile bar and
      // the desktop mega-menu dropdown paint over page content.
      className="relative z-40 bg-background border-b border-border"
      style={{ viewTransitionName: "site-header" }}
    >
      <Suspense fallback={<HeaderSkeleton />}>
        <HeaderInner />
      </Suspense>
    </header>
  );
});

Header.displayName = "Header";
