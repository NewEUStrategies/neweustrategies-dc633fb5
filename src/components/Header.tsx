import { useTranslation } from "react-i18next";
import { useSuspenseQuery } from "@tanstack/react-query";
import { memo, Suspense, useEffect, useState } from "react";
import { Menu, X, LogIn, UserPlus, User, LayoutDashboard, LogOut, Home, Newspaper, Tag, Mic, Mail, DollarSign } from "lucide-react";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import type { BuilderDocument } from "@/lib/builder/types";
import type { TickerConfig } from "@/lib/views/headerTickerQuery";
import { AlertBar } from "@/components/AlertBar";
import { AdZone } from "@/components/AdSlot";
import { TrendingTicker } from "@/components/header/TrendingTicker";
import { HeaderSkeleton } from "@/components/header/HeaderSkeleton";
import { AppLink } from "@/components/atoms/AppLink";
import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";


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
  const trending = cfg.trending ?? { enabled: true };
  const siteName = (general.site_name && general.site_name.trim()) || "Menu";

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
  // Prefer i18n if defined, else fall back to the two hardcoded strings above.
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

      {/* Mobile compact bar: site name + hamburger. Hidden on tablet/desktop. */}
      <div className="lg:hidden sticky top-0 z-[9998] flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-background">
        <AppLink
          href="/"
          className="text-base font-bold tracking-tight text-foreground truncate min-w-0"
        >
          {siteName}
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

      {/* Mobile/Tablet drawer: renders the same builder-authored header. */}
      {open && (
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
            <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [&_*]:max-w-full">
              <MobileAccountNav isPl={isPl} onNavigate={() => setOpen(false)} />
              {/* Force mobile-device rendering inside the drawer so widgets
                  stack vertically (columns collapse to single column). */}
              <BuilderRenderer
                doc={cfg.builder_data}
                lang={isPl ? "pl" : "en"}
                device="mobile"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MobileAccountNav({ isPl, onNavigate }: { isPl: boolean; onNavigate: () => void }) {
  const { session, isStaff, signOut } = useAuth();
  const t = (pl: string, en: string) => (isPl ? pl : en);

  const navItems: Array<{ to: string; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { to: "/", label: t("Strona główna", "Home"), icon: Home },
    { to: "/blog", label: t("Aktualności", "News"), icon: Newspaper },
    { to: "/pricing", label: t("Cennik", "Pricing"), icon: DollarSign },
  ];

  const linkCls =
    "flex items-center gap-3 px-4 py-3 text-sm font-medium text-foreground hover:bg-muted border-b border-border/60 transition";
  const primaryBtn =
    "flex-1 inline-flex items-center justify-center gap-2 h-10 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition";
  const secondaryBtn =
    "flex-1 inline-flex items-center justify-center gap-2 h-10 px-3 rounded-md border border-border text-foreground text-sm font-semibold hover:bg-muted transition";

  return (
    <div className="border-b border-border bg-muted/30">
      <div className="px-4 py-4">
        <p className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground mb-2">
          {t("Moje konto", "My account")}
        </p>
        {session ? (
          <div className="flex flex-col gap-2">
            <Link
              to={isStaff ? "/admin" : "/profile"}
              onClick={onNavigate}
              className={primaryBtn}
            >
              {isStaff ? <LayoutDashboard className="w-4 h-4" /> : <User className="w-4 h-4" />}
              {isStaff ? t("Panel", "Dashboard") : t("Mój profil", "My profile")}
            </Link>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                onNavigate();
              }}
              className={secondaryBtn}
            >
              <LogOut className="w-4 h-4" />
              {t("Wyloguj", "Sign out")}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Link to="/login" onClick={onNavigate} className={primaryBtn}>
              <LogIn className="w-4 h-4" />
              {t("Zaloguj", "Sign in")}
            </Link>
            <Link
              to="/login"
              search={{ mode: "signup" }}
              onClick={onNavigate}
              className={secondaryBtn}
            >
              <UserPlus className="w-4 h-4" />
              {t("Zarejestruj", "Register")}
            </Link>
          </div>
        )}
      </div>
      <nav aria-label={t("Menu główne", "Main menu")} className="border-t border-border">
        <p className="px-4 pt-3 pb-2 text-[11px] font-bold tracking-wider uppercase text-muted-foreground">
          {t("Nawigacja", "Navigation")}
        </p>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to} onClick={onNavigate} className={linkCls}>
              <Icon className="w-4 h-4 text-muted-foreground" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export const Header = memo(function Header() {
  // Suspense fallback only fires when the loader hasn't pre-warmed the cache
  // (e.g. routes that opt out of the prefetch). In normal navigation the
  // inner component resolves synchronously and this boundary is a no-op.
  return (
    <header
      data-site-header
      className="bg-background border-b border-border"
      style={{ viewTransitionName: "site-header" }}
    >
      <Suspense fallback={<HeaderSkeleton />}> 
        <HeaderInner />
      </Suspense>
    </header>
  );
});

Header.displayName = "Header";
