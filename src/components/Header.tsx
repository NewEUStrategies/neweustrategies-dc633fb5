import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Moon, Sun, Search, Menu, X, Mail, Facebook, Twitter, Youtube, Instagram, Linkedin, Send, LogIn, LayoutDashboard } from "@/lib/lucide-shim";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "./ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import type { BuilderDocument } from "@/lib/builder/types";
import { AlertBar } from "@/components/AlertBar";
import { SearchOverlay } from "@/components/SearchOverlay";
import logo from "@/assets/logo.png";

type ThemeOptions = {
  logo: {
    main: string; main_dark: string; mobile: string; mobile_dark: string;
    transparent: string; organization: string;
    bookmark_ios: string; bookmark_windows: string; add_to_home_screen: boolean;
  };
  header: {
    layout: "layout-1" | "layout-2" | "layout-3" | "layout-4" | "layout-5";
    main_menu: {
      hover_effect: "color-border" | "underline" | "background" | "scale" | "none";
      sticky: boolean; smart_sticky: boolean; glass_effect: boolean;
      item_spacing: number; icon_spacing: number;
      submenu_bg_from: string; submenu_bg_to: string;
    };
    search: {
      enabled: boolean; heading: string;
      mode: "standalone" | "dropdown" | "fullscreen";
      live_results: boolean; live_limit: number; more_menu_search: boolean;
    };
    mobile: {
      breakpoint: number; use_mobile_logo: boolean; sticky: boolean; show_search: boolean;
    };
    signin: {
      enabled: boolean;
      signin_label_pl: string; signin_label_en: string;
      signup_label_pl: string; signup_label_en: string;
      variant: "solid" | "outline" | "ghost" | "pill";
      show_signup: boolean;
    };
    socials: {
      placement: "topbar" | "main" | "hidden";
      facebook: string; twitter: string; instagram: string; linkedin: string; youtube: string; email: string;
      size: number;
    };
  };
};

const THEME_DEFAULTS: ThemeOptions = {
  logo: { main: "", main_dark: "", mobile: "", mobile_dark: "", transparent: "", organization: "", bookmark_ios: "", bookmark_windows: "", add_to_home_screen: true },
  header: {
    layout: "layout-1",
    main_menu: { hover_effect: "color-border", sticky: true, smart_sticky: false, glass_effect: false, item_spacing: 12, icon_spacing: 5, submenu_bg_from: "", submenu_bg_to: "" },
    search: { enabled: true, heading: "Search", mode: "standalone", live_results: true, live_limit: 5, more_menu_search: true },
    mobile: { breakpoint: 1024, use_mobile_logo: true, sticky: true, show_search: true },
    signin: { enabled: true, signin_label_pl: "Zaloguj", signin_label_en: "Sign in", signup_label_pl: "Zarejestruj", signup_label_en: "Sign up", variant: "ghost", show_signup: true },
    socials: { placement: "topbar", facebook: "", twitter: "", instagram: "", linkedin: "", youtube: "", email: "", size: 16 },
  },
};

const SIGNIN_CLASS: Record<ThemeOptions["header"]["signin"]["variant"], string> = {
  solid: "px-3 py-1.5 rounded bg-brand text-brand-foreground hover:opacity-90",
  outline: "px-3 py-1.5 rounded border border-brand text-brand hover:bg-brand hover:text-brand-foreground",
  ghost: "font-semibold text-muted-foreground hover:text-brand",
  pill: "px-3 py-1.5 rounded-full bg-brand text-brand-foreground hover:opacity-90",
};

const HOVER_CLASS: Record<ThemeOptions["header"]["main_menu"]["hover_effect"], string> = {
  "color-border": "border-b-2 border-transparent hover:border-brand hover:text-brand",
  underline: "hover:underline underline-offset-8 decoration-2 hover:text-brand",
  background: "rounded hover:bg-muted hover:text-brand",
  scale: "hover:scale-110 hover:text-brand",
  none: "hover:text-brand",
};

type MenuItem = { label_pl: string; label_en: string; url: string };

export function Header() {
  const { t, i18n } = useTranslation();
  const { theme, toggle } = useTheme();
  const { session, isStaff } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const lang = i18n.language ?? "pl";

  const setLang = (lng: "pl" | "en") => i18n.changeLanguage(lng);

  const menu = useSiteSetting<{ items: MenuItem[] }>("menu_primary", { items: [] });
  const themeOpts = useSiteSetting<ThemeOptions>("theme_options", THEME_DEFAULTS);
  const headerCfg = useSiteSetting<{
    show_newsletter: boolean; show_socials: boolean;
    social_facebook: string; social_twitter: string; social_youtube: string;
    social_instagram: string; social_linkedin: string; contact_email: string;
    builder_data?: BuilderDocument | null;
  }>("header", {
    show_newsletter: true,
    show_socials: true,
    social_facebook: "#", social_twitter: "#", social_youtube: "#", social_instagram: "#", social_linkedin: "#",
    contact_email: "",
  });

  // Smart-sticky: hide on scroll down, show on scroll up. Sticky: always fixed at top.
  const [navHidden, setNavHidden] = useState(false);
  const lastY = useRef(0);
  const headerOpts = { ...THEME_DEFAULTS.header, ...(themeOpts.header ?? {}) };
  const mainMenu = { ...THEME_DEFAULTS.header.main_menu, ...(headerOpts.main_menu ?? {}) };
  const mobileOpts = { ...THEME_DEFAULTS.header.mobile, ...(headerOpts.mobile ?? {}) };
  const searchOpts = { ...THEME_DEFAULTS.header.search, ...(headerOpts.search ?? {}) };
  const signinOpts = { ...THEME_DEFAULTS.header.signin, ...(headerOpts.signin ?? {}) };
  const socialsOpts = { ...THEME_DEFAULTS.header.socials, ...(headerOpts.socials ?? {}) };
  const logoOpts = { ...THEME_DEFAULTS.logo, ...(themeOpts.logo ?? {}) };
  const { sticky, smart_sticky, glass_effect, hover_effect, item_spacing } = mainMenu;
  useEffect(() => {
    if (!smart_sticky) return;
    const onScroll = () => {
      const y = window.scrollY;
      setNavHidden(y > 80 && y > lastY.current);
      lastY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [smart_sticky]);

  // Track viewport for mobile-logo swap based on configured breakpoint.
  const [isMobile, setIsMobile] = useState(false);
  const mobileBp = themeOpts.header.mobile.breakpoint;
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${mobileBp - 1}px)`);
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mobileBp]);

  const desktopLogo = theme === "dark"
    ? (themeOpts.logo.main_dark || themeOpts.logo.main || logo)
    : (themeOpts.logo.main || logo);
  const mobileLogo = theme === "dark"
    ? (themeOpts.logo.mobile_dark || themeOpts.logo.mobile || desktopLogo)
    : (themeOpts.logo.mobile || desktopLogo);
  const logoSrc = (isMobile && themeOpts.header.mobile.use_mobile_logo) ? mobileLogo : desktopLogo;

  if (headerCfg.builder_data && headerCfg.builder_data.sections?.length) {
    return (
      <header className="bg-background border-b border-border">
        <AlertBar />
        <BuilderRenderer doc={headerCfg.builder_data} lang={lang.startsWith("pl") ? "pl" : "en"} />
      <SearchOverlay
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          mode={themeOpts.header.search.mode}
          heading={themeOpts.header.search.heading}
          liveResults={themeOpts.header.search.live_results}
          limit={themeOpts.header.search.live_limit}
          lang={lang.startsWith("pl") ? "pl" : "en"}
        />
        </header>
    );
  }

  const defaultNav: MenuItem[] = [
    { label_pl: t("nav.analyses"), label_en: t("nav.analyses"), url: "#" },
    { label_pl: t("nav.interviews"), label_en: t("nav.interviews"), url: "#" },
    { label_pl: t("nav.policyPapers"), label_en: t("nav.policyPapers"), url: "#" },
    { label_pl: t("nav.reports"), label_en: t("nav.reports"), url: "#" },
    { label_pl: t("nav.events"), label_en: t("nav.events"), url: "#" },
    { label_pl: t("nav.about"), label_en: t("nav.about"), url: "#" },
  ];
  const nav = (menu.items?.length ? menu.items : defaultNav).map((m) => ({
    label: lang.startsWith("pl") ? m.label_pl : m.label_en,
    url: m.url,
  }));

  // ---------- Layout 2: Logo Left (single-bar) ----------
  if (themeOpts.header.layout === "layout-2") {
    return (
      <header className="bg-background border-b border-border">
        <AlertBar />
        <div
          className={[
            "bg-background transition-transform duration-300",
            sticky ? "sticky top-0 z-40" : "",
            glass_effect ? "backdrop-blur-md bg-background/70" : "",
            navHidden ? "-translate-y-full" : "translate-y-0",
          ].filter(Boolean).join(" ")}
        >
          <div className="max-w-[1400px] mx-auto px-4 lg:px-8 h-16 flex items-center justify-between gap-6">
            <Link to="/" className="flex items-center gap-2 shrink-0">
              <img src={logoSrc} alt="Logo" className="h-9 w-auto object-contain" />
              {!themeOpts.logo.main && (
                <span className="font-display font-bold text-base hidden sm:inline">New <span className="text-brand">European</span> Strategies</span>
              )}
            </Link>
            <nav className="hidden lg:flex items-center gap-2 flex-1 justify-center">
              {nav.map((item) => (
                <a key={item.label} href={item.url || "#"}
                  style={{ paddingLeft: item_spacing, paddingRight: item_spacing }}
                  className={`flex items-center gap-1 py-2 text-xs font-bold tracking-wider text-foreground transition ${HOVER_CLASS[hover_effect]}`}>
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-3 shrink-0">
              {themeOpts.header.search.enabled && (
                <button aria-label="Search" onClick={() => setSearchOpen(true)} className="p-2 hover:text-brand transition">
                  <Search className="w-4 h-4" />
                </button>
              )}
              {session && isStaff ? (
                <Link to="/admin" className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                  <LayoutDashboard className="w-3.5 h-3.5" /> {lang.startsWith("pl") ? "Panel" : "Dashboard"}
                </Link>
              ) : themeOpts.header.signin.enabled ? (
                <Link to="/login" className={`inline-flex items-center gap-1 text-xs ${SIGNIN_CLASS[themeOpts.header.signin.variant]}`}>
                  <LogIn className="w-3.5 h-3.5" />
                  {lang.startsWith("pl") ? themeOpts.header.signin.signin_label_pl : themeOpts.header.signin.signin_label_en}
                </Link>
              ) : null}
              <button onClick={toggle} aria-label="Toggle theme" className="p-2 rounded-full hover:bg-muted transition">
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button onClick={() => setMobileOpen((o) => !o)} className="lg:hidden p-2 rounded-full hover:bg-muted" aria-label="Menu">
                {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
          {mobileOpen && (
            <div className="lg:hidden border-t border-border py-4 px-4 flex flex-col gap-3">
              {nav.map((item) => (
                <a key={item.label} href={item.url || "#"} className="text-left text-sm font-semibold tracking-wider text-foreground/80">{item.label}</a>
              ))}
            </div>
          )}
        </div>
      <SearchOverlay
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          mode={themeOpts.header.search.mode}
          heading={themeOpts.header.search.heading}
          liveResults={themeOpts.header.search.live_results}
          limit={themeOpts.header.search.live_limit}
          lang={lang.startsWith("pl") ? "pl" : "en"}
        />
        </header>
    );
  }

  // ---------- Layout 3: Split Nav (logo center, nav split left/right) ----------
  if (themeOpts.header.layout === "layout-3") {
    const half = Math.ceil(nav.length / 2);
    const leftNav = nav.slice(0, half);
    const rightNav = nav.slice(half);
    return (
      <header className="bg-background border-b border-border">
        <AlertBar />
        <div
          className={[
            "bg-background transition-transform duration-300",
            sticky ? "sticky top-0 z-40" : "",
            glass_effect ? "backdrop-blur-md bg-background/70" : "",
            navHidden ? "-translate-y-full" : "translate-y-0",
          ].filter(Boolean).join(" ")}
        >
          <div className="max-w-[1400px] mx-auto px-4 lg:px-8 h-20 grid grid-cols-3 items-center gap-4">
            <nav className="hidden lg:flex items-center justify-end gap-1">
              {leftNav.map((item) => (
                <a key={item.label} href={item.url || "#"}
                  style={{ paddingLeft: item_spacing, paddingRight: item_spacing }}
                  className={`py-2 text-xs font-bold tracking-wider text-foreground transition ${HOVER_CLASS[hover_effect]}`}>
                  {item.label}
                </a>
              ))}
            </nav>
            <Link to="/" className="flex items-center justify-center gap-2">
              <img src={logoSrc} alt="Logo" className="h-12 w-auto object-contain" />
            </Link>
            <nav className="hidden lg:flex items-center justify-start gap-1">
              {rightNav.map((item) => (
                <a key={item.label} href={item.url || "#"}
                  style={{ paddingLeft: item_spacing, paddingRight: item_spacing }}
                  className={`py-2 text-xs font-bold tracking-wider text-foreground transition ${HOVER_CLASS[hover_effect]}`}>
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
          <div className="lg:hidden border-t border-border px-4 py-2 flex items-center justify-between">
            {themeOpts.header.search.enabled && (
              <button aria-label="Search" onClick={() => setSearchOpen(true)} className="p-2 hover:text-brand"><Search className="w-4 h-4" /></button>
            )}
            <button onClick={toggle} aria-label="Toggle theme" className="p-2 rounded-full hover:bg-muted">
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={() => setMobileOpen((o) => !o)} className="p-2 rounded-full hover:bg-muted" aria-label="Menu">
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
          {mobileOpen && (
            <div className="lg:hidden border-t border-border py-4 px-4 flex flex-col gap-3">
              {nav.map((item) => (
                <a key={item.label} href={item.url || "#"} className="text-left text-sm font-semibold tracking-wider text-foreground/80">{item.label}</a>
              ))}
            </div>
          )}
        </div>
      <SearchOverlay
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          mode={themeOpts.header.search.mode}
          heading={themeOpts.header.search.heading}
          liveResults={themeOpts.header.search.live_results}
          limit={themeOpts.header.search.live_limit}
          lang={lang.startsWith("pl") ? "pl" : "en"}
        />
        </header>
    );
  }

  // ---------- Layout 4: Stacked Compact (top-bar utilities + logo+nav row) ----------
  if (themeOpts.header.layout === "layout-4") {
    return (
      <header className="bg-background border-b border-border">
        <AlertBar />
        <div className="border-b border-border">
          <div className="max-w-[1400px] mx-auto px-4 lg:px-8 h-9 flex items-center justify-end gap-3 text-xs">
            {headerCfg.show_socials && (
              <div className="hidden sm:flex items-center gap-2 text-muted-foreground">
                <a href={headerCfg.social_facebook || "#"} aria-label="Facebook" className="hover:text-brand"><Facebook className="w-3.5 h-3.5" /></a>
                <a href={headerCfg.social_twitter || "#"} aria-label="X" className="hover:text-brand"><Twitter className="w-3.5 h-3.5" /></a>
                <a href={headerCfg.social_linkedin || "#"} aria-label="LinkedIn" className="hover:text-brand"><Linkedin className="w-3.5 h-3.5" /></a>
              </div>
            )}
            {themeOpts.header.signin.enabled && !session && (
              <Link to="/login" className={`inline-flex items-center gap-1 text-xs ${SIGNIN_CLASS[themeOpts.header.signin.variant]}`}>
                <LogIn className="w-3.5 h-3.5" />
                {lang.startsWith("pl") ? themeOpts.header.signin.signin_label_pl : themeOpts.header.signin.signin_label_en}
              </Link>
            )}
          </div>
        </div>
        <div
          className={[
            "bg-background transition-transform duration-300",
            sticky ? "sticky top-0 z-40" : "",
            glass_effect ? "backdrop-blur-md bg-background/70" : "",
            navHidden ? "-translate-y-full" : "translate-y-0",
          ].filter(Boolean).join(" ")}
        >
          <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-4 flex items-center justify-between gap-6">
            <Link to="/" className="flex items-center gap-2">
              <img src={logoSrc} alt="Logo" className="h-10 w-auto object-contain" />
            </Link>
            <nav className="hidden lg:flex items-center gap-1">
              {nav.map((item) => (
                <a key={item.label} href={item.url || "#"}
                  style={{ paddingLeft: item_spacing, paddingRight: item_spacing }}
                  className={`py-2 text-xs font-bold tracking-wider text-foreground transition ${HOVER_CLASS[hover_effect]}`}>
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              {themeOpts.header.search.enabled && (
                <button aria-label="Search" onClick={() => setSearchOpen(true)} className="p-2 hover:text-brand"><Search className="w-4 h-4" /></button>
              )}
              <button onClick={toggle} aria-label="Toggle theme" className="p-2 rounded-full hover:bg-muted">
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button onClick={() => setMobileOpen((o) => !o)} className="lg:hidden p-2 rounded-full hover:bg-muted" aria-label="Menu">
                {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
          {mobileOpen && (
            <div className="lg:hidden border-t border-border py-4 px-4 flex flex-col gap-3">
              {nav.map((item) => (
                <a key={item.label} href={item.url || "#"} className="text-left text-sm font-semibold tracking-wider text-foreground/80">{item.label}</a>
              ))}
            </div>
          )}
        </div>
      <SearchOverlay
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          mode={themeOpts.header.search.mode}
          heading={themeOpts.header.search.heading}
          liveResults={themeOpts.header.search.live_results}
          limit={themeOpts.header.search.live_limit}
          lang={lang.startsWith("pl") ? "pl" : "en"}
        />
        </header>
    );
  }

  // ---------- Layout 5: Minimal (logo left, hamburger overlay menu) ----------
  if (themeOpts.header.layout === "layout-5") {
    return (
      <header className="bg-background border-b border-border">
        <AlertBar />
        <div
          className={[
            "bg-background transition-transform duration-300",
            sticky ? "sticky top-0 z-40" : "",
            glass_effect ? "backdrop-blur-md bg-background/70" : "",
            navHidden ? "-translate-y-full" : "translate-y-0",
          ].filter(Boolean).join(" ")}
        >
          <div className="max-w-[1400px] mx-auto px-4 lg:px-8 h-16 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <img src={logoSrc} alt="Logo" className="h-9 w-auto object-contain" />
            </Link>
            <div className="flex items-center gap-2">
              {themeOpts.header.search.enabled && (
                <button aria-label="Search" onClick={() => setSearchOpen(true)} className="p-2 hover:text-brand"><Search className="w-4 h-4" /></button>
              )}
              <button onClick={toggle} aria-label="Toggle theme" className="p-2 rounded-full hover:bg-muted">
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button onClick={() => setMobileOpen((o) => !o)} className="p-2 rounded-full hover:bg-muted inline-flex items-center gap-2" aria-label="Menu">
                {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                <span className="text-xs font-bold tracking-wider hidden sm:inline">MENU</span>
              </button>
            </div>
          </div>
        </div>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-md flex flex-col">
            <div className="max-w-[1400px] mx-auto px-4 lg:px-8 h-16 flex items-center justify-between w-full">
              <Link to="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2">
                <img src={logoSrc} alt="Logo" className="h-9 w-auto object-contain" />
              </Link>
              <button onClick={() => setMobileOpen(false)} className="p-2 rounded-full hover:bg-muted" aria-label="Close">
                <X className="w-6 h-6" />
              </button>
            </div>
            <nav className="flex-1 flex flex-col items-center justify-center gap-6">
              {nav.map((item) => (
                <a key={item.label} href={item.url || "#"} onClick={() => setMobileOpen(false)}
                  className={`text-2xl md:text-4xl font-display font-bold tracking-tight transition ${HOVER_CLASS[hover_effect]}`}>
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        )}
      <SearchOverlay
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          mode={themeOpts.header.search.mode}
          heading={themeOpts.header.search.heading}
          liveResults={themeOpts.header.search.live_results}
          limit={themeOpts.header.search.live_limit}
          lang={lang.startsWith("pl") ? "pl" : "en"}
        />
        </header>
    );
  }

  // ---------- Layout 1 (default): Classic Centered ----------
  return (
    <header className="bg-background border-b border-border">
      <AlertBar />


      {/* Utility bar */}
      <div className="border-b border-border">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8 h-11 flex items-center justify-between text-xs">
          <div className="flex items-center gap-5">
            {headerCfg.show_newsletter && (
              <a href="#newsletter" className="flex items-center gap-2 font-semibold text-foreground hover:text-brand transition">
                <span className="w-7 h-7 rounded-full bg-brand text-brand-foreground inline-flex items-center justify-center">
                  <Send className="w-3.5 h-3.5" />
                </span>
                {t("nav.newsletter")}
              </a>
            )}
            {headerCfg.show_socials && (
              <div className="hidden sm:flex items-center gap-3 text-muted-foreground">
                <a href={headerCfg.social_facebook || "#"} aria-label="Facebook" className="hover:text-brand"><Facebook className="w-4 h-4" /></a>
                <a href={headerCfg.social_twitter || "#"} aria-label="X" className="hover:text-brand"><Twitter className="w-4 h-4" /></a>
                <a href={headerCfg.social_youtube || "#"} aria-label="YouTube" className="hover:text-brand"><Youtube className="w-4 h-4" /></a>
                <a href={headerCfg.social_instagram || "#"} aria-label="Instagram" className="hover:text-brand"><Instagram className="w-4 h-4" /></a>
                <a href={headerCfg.social_linkedin || "#"} aria-label="LinkedIn" className="hover:text-brand"><Linkedin className="w-4 h-4" /></a>
                {headerCfg.contact_email && (
                  <a href={`mailto:${headerCfg.contact_email}`} aria-label="Email" className="hover:text-brand"><Mail className="w-4 h-4" /></a>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {session && isStaff ? (
              <Link to="/admin" className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                <LayoutDashboard className="w-3.5 h-3.5" /> {lang.startsWith("pl") ? "Panel" : "Dashboard"}
              </Link>
            ) : themeOpts.header.signin.enabled ? (
              <span className="hidden sm:inline-flex items-center gap-2 text-xs">
                <Link
                  to="/login"
                  className={`inline-flex items-center gap-1 ${SIGNIN_CLASS[themeOpts.header.signin.variant]}`}
                >
                  <LogIn className="w-3.5 h-3.5" />
                  {lang.startsWith("pl") ? themeOpts.header.signin.signin_label_pl : themeOpts.header.signin.signin_label_en}
                </Link>
                {themeOpts.header.signin.show_signup && (
                  <>
                    <span className="text-muted-foreground/40">|</span>
                    <Link to="/login" search={{ mode: "signup" }} className="font-semibold text-brand hover:underline">
                      {lang.startsWith("pl") ? themeOpts.header.signin.signup_label_pl : themeOpts.header.signin.signup_label_en}
                    </Link>
                  </>
                )}
              </span>
            ) : null}
            <span className="hidden md:inline text-muted-foreground">
              {lang.startsWith("pl") ? "Zmień język" : "Switch language"}
            </span>
            <button
              onClick={() => setLang("en")}
              aria-label="English"
              className={`text-base leading-none transition ${lang.startsWith("en") ? "opacity-100" : "opacity-60 hover:opacity-100"}`}
            >
              🇬🇧
            </button>
            <button
              onClick={() => setLang("pl")}
              aria-label="Polski"
              className={`text-base leading-none transition ${lang.startsWith("pl") ? "opacity-100" : "opacity-60 hover:opacity-100"}`}
            >
              🇵🇱
            </button>
          </div>
        </div>
      </div>

      {/* Centered logo */}
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-6 flex justify-center">
        <Link to="/" className="flex items-center gap-3">
          <img src={logoSrc} alt="New European Strategies" className="w-12 h-12 md:w-14 md:h-14 object-contain" width={56} height={56} />
          {!themeOpts.logo.main && (
            <div className="leading-[1.05]">
              <div className="font-display font-bold text-xl md:text-2xl">New</div>
              <div className="font-display font-bold text-xl md:text-2xl text-brand">European</div>
              <div className="font-display font-bold text-xl md:text-2xl">Strategies</div>
            </div>
          )}
        </Link>
      </div>

      {/* Nav bar */}
      <div
        className={[
          "border-t border-border bg-background transition-transform duration-300",
          sticky ? "sticky top-0 z-40" : "",
          glass_effect ? "backdrop-blur-md bg-background/70" : "",
          navHidden ? "-translate-y-full" : "translate-y-0",
        ].filter(Boolean).join(" ")}
      >
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8 h-14 flex items-center justify-between gap-4">
          {themeOpts.header.search.enabled && (
            <button
              aria-label="Search"
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition"
            >
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline">{themeOpts.header.search.heading || t("nav.search")}</span>
            </button>
          )}

          <nav className="hidden lg:flex items-center gap-2">
            {nav.map((item) => (
              <a
                key={item.label}
                href={item.url || "#"}
                style={{ paddingLeft: item_spacing, paddingRight: item_spacing }}
                className={`flex items-center gap-1 py-2 text-xs font-bold tracking-wider text-foreground transition ${HOVER_CLASS[hover_effect]}`}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <button
              onClick={toggle}
              aria-label="Toggle theme"
              className="p-2 rounded-full hover:bg-muted transition"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setMobileOpen((o) => !o)}
              className="lg:hidden p-2 rounded-full hover:bg-muted"
              aria-label="Menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="lg:hidden border-t border-border py-4 px-4 flex flex-col gap-3">
            {nav.map((item) => (
              <a
                key={item.label}
                href={item.url || "#"}
                className="text-left text-sm font-semibold tracking-wider text-foreground/80"
              >
                {item.label}
              </a>
            ))}
          </div>
        )}
      </div>
    <SearchOverlay
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          mode={themeOpts.header.search.mode}
          heading={themeOpts.header.search.heading}
          liveResults={themeOpts.header.search.live_results}
          limit={themeOpts.header.search.live_limit}
          lang={lang.startsWith("pl") ? "pl" : "en"}
        />
        </header>
  );
}
